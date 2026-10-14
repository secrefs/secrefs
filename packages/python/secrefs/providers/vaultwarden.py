"""
Vaultwarden, and any other Bitwarden **password vault** - including
bitwarden.com - through the official Bitwarden CLI (`bw`).

Vaultwarden does not implement Bitwarden Secrets Manager, so
BitwardenProvider can't reach it. Vault items are end-to-end encrypted, and
the supported way for a script to decrypt them is `bw`, which is what this
drives: log in once with `bw config server <url>` and `bw login`, then
export the session from `bw unlock --raw` as BW_SESSION. The session is
handed to `bw` through the environment, never on the command line, where
any local user could read it from the process list.

`path` is an item's id, or its exact name. A name that isn't unique may be
qualified by folder: `sec://vaultwarden/prod/stripe` is the item "stripe"
in the folder "prod". Matching is exact - `bw get item <name>` matches
substrings, so it is never used for names.

With no `#field`, a login returns its password and a secure note its notes.
`#username`, `#password`, `#totp`, `#uri` and `#notes` read those parts of
the item; any other field is a custom field of that name, or a key in notes
that hold JSON. Mirrors packages/node/src/providers/vaultwarden.ts.
"""

from __future__ import annotations

import asyncio
import json
import os
import re
from typing import Any, Awaitable, Callable, Dict, List, Optional, Tuple

from .base import ProviderHealth, SecretFetchRequest, SecretProvider, extract_field

UUID_PATTERN = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.IGNORECASE
)
AUTH_MESSAGES = re.compile(
    r"vault is locked|not logged in|session key is invalid|invalid master password|unauthenticated",
    re.IGNORECASE,
)
LOGIN = 1
SECURE_NOTE = 2
BUILT_IN_FIELDS = ("password", "username", "totp", "uri", "notes")
MAX_CONCURRENT = 4

# (args, env) -> (stdout, stderr, returncode)
BwRunner = Callable[[List[str], Dict[str, str]], Awaitable[Tuple[str, str, Optional[int]]]]


class VaultwardenAuthError(ValueError):
    """The vault is locked, the session is missing or expired, or bw is
    logged in to a different server. Nothing is wrong with the reference."""


class VaultwardenNotFoundError(ValueError):
    pass


class VaultwardenProvider(SecretProvider):
    name = "vaultwarden"

    def __init__(
        self,
        session: Optional[str] = None,
        server_url: Optional[str] = None,
        app_data_dir: Optional[str] = None,
        bw_path: Optional[str] = None,
        sync: bool = True,
        timeout_s: float = 30.0,
        run: Optional[BwRunner] = None,
    ) -> None:
        self._session = session if session is not None else os.environ.get("BW_SESSION")
        self._server_url = server_url
        self._app_data_dir = app_data_dir
        self._bw_path = bw_path or os.environ.get("SECREFS_BW_PATH") or "bw"
        self._sync = sync
        self._timeout_s = timeout_s
        self._run = run or self._spawn
        self._ready: Optional["asyncio.Future[None]"] = None
        self._in_flight: Dict[str, "asyncio.Future[Dict[str, Any]]"] = {}
        self._semaphore: Optional[asyncio.Semaphore] = None

    async def _spawn(self, args: List[str], env: Dict[str, str]) -> Tuple[str, str, Optional[int]]:
        proc = await asyncio.create_subprocess_exec(
            self._bw_path,
            *args,
            env=env,
            stdin=asyncio.subprocess.DEVNULL,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            out, err = await asyncio.wait_for(proc.communicate(), timeout=self._timeout_s)
        except asyncio.TimeoutError:
            proc.kill()
            raise TimeoutError(f"bw {args[2] if len(args) > 2 else ''} timed out after {self._timeout_s}s")
        return out.decode(), err.decode(), proc.returncode

    async def _bw(self, *args: str) -> Any:
        if self._semaphore is None:
            self._semaphore = asyncio.Semaphore(MAX_CONCURRENT)
        env = {**os.environ, "BW_NOINTERACTION": "true"}
        if self._session:
            env["BW_SESSION"] = self._session
        if self._app_data_dir:
            env["BITWARDENCLI_APPDATA_DIR"] = self._app_data_dir

        async with self._semaphore:
            try:
                stdout, stderr, code = await self._run(["--response", "--nointeraction", *args], env)
            except FileNotFoundError as exc:
                raise ValueError(
                    f'the Bitwarden CLI ("{self._bw_path}") was not found. Install it with '
                    '"npm install -g @bitwarden/cli", or set SECREFS_BW_PATH.'
                ) from exc

        try:
            parsed = json.loads(stdout)
        except json.JSONDecodeError:
            # Never echo stdout: on a misparse it may be anything.
            raise ValueError(f"bw {args[0]} failed (exit {code}): {stderr.strip()[:200] or 'no output'}")
        if parsed.get("success"):
            return parsed.get("data")

        message = (parsed.get("message") or f"bw {args[0]} failed").strip()
        if AUTH_MESSAGES.search(message):
            raise VaultwardenAuthError(message)
        if re.match(r"not found", message, re.IGNORECASE):
            raise VaultwardenNotFoundError(message)
        raise ValueError(message)

    async def _status(self) -> Dict[str, Any]:
        data = await self._bw("status")
        status = (data or {}).get("template", data) if isinstance(data, dict) else None
        return status or {}

    async def _prepare(self) -> None:
        if not self._session:
            raise VaultwardenAuthError(
                "BW_SESSION is not set (required for sec://vaultwarden/... references). "
                'Unlock the vault: export BW_SESSION="$(bw unlock --raw)"'
            )
        status = await self._status()
        if status.get("status") != "unlocked":
            raise VaultwardenAuthError(
                f"bw is {status.get('status') or 'not ready'}, not unlocked. "
                'Unlock the vault: export BW_SESSION="$(bw unlock --raw)"'
            )
        if self._server_url and _normalize(status.get("serverUrl")) != _normalize(self._server_url):
            raise VaultwardenAuthError(
                f"bw is logged in to {status.get('serverUrl') or 'the default server'}, not {self._server_url}"
            )
        if self._sync:
            await self._bw("sync")

    async def _ensure_ready(self) -> None:
        if self._ready is None:
            self._ready = asyncio.ensure_future(self._prepare())
        try:
            await asyncio.shield(self._ready)
        except BaseException:
            self._ready = None  # let the next call try again
            raise

    async def _item(self, path: str) -> Dict[str, Any]:
        pending = self._in_flight.get(path)
        if pending is None:
            pending = asyncio.ensure_future(self._lookup(path))
            self._in_flight[path] = pending
            pending.add_done_callback(lambda _: self._in_flight.pop(path, None))
        return await asyncio.shield(pending)

    async def _items_named(self, name: str) -> List[Dict[str, Any]]:
        items = _as_list(await self._bw("list", "items", "--search", name))
        return [i for i in items if i.get("name") == name]

    async def _lookup(self, path: str) -> Dict[str, Any]:
        if UUID_PATTERN.match(path):
            return dict(await self._bw("get", "item", path))

        exact = await self._items_named(path)
        if len(exact) == 1:
            return exact[0]
        if len(exact) > 1:
            raise _ambiguous(path, len(exact))

        if "/" in path.strip("/"):
            folder_name, item_name = path.rsplit("/", 1)
            folders = _as_list(await self._bw("list", "folders", "--search", folder_name))
            folder_ids = {f.get("id") for f in folders if f.get("name") == folder_name}
            if folder_ids:
                in_folder = [i for i in await self._items_named(item_name) if i.get("folderId") in folder_ids]
                if len(in_folder) == 1:
                    return in_folder[0]
                if len(in_folder) > 1:
                    raise _ambiguous(path, len(in_folder))

        raise VaultwardenNotFoundError(f'no item named "{path}"')

    async def fetch_one(self, request: SecretFetchRequest) -> str:
        await self._ensure_ready()
        item = await self._item(request.path)
        return value_of(item, request.field, request.path)

    async def health_check(self) -> ProviderHealth:
        try:
            await self._ensure_ready()
            server = (await self._status()).get("serverUrl") or "default server"
            return ProviderHealth(provider=self.name, ok=True, message=f"unlocked, {server}")
        except Exception as exc:  # noqa: BLE001
            return ProviderHealth(provider=self.name, ok=False, message=str(exc))


def _as_list(data: Any) -> List[Dict[str, Any]]:
    if isinstance(data, list):
        return data
    inner = data.get("data") if isinstance(data, dict) else None
    return inner if isinstance(inner, list) else []


def _ambiguous(path: str, count: int) -> ValueError:
    return ValueError(
        f'{count} items are named "{path}". Qualify it with its folder '
        "(sec://<alias>/<folder>/<name>) or use the item id."
    )


def _normalize(url: Optional[str]) -> str:
    return (url or "").strip().rstrip("/").lower()


def value_of(item: Dict[str, Any], field: Optional[str], path: str) -> str:
    """Picks the requested part of an item. Errors name the item and the
    fields that exist, never a value."""
    login = item.get("login") or {}
    uris = login.get("uris") or []
    built_in: Dict[str, Optional[str]] = {
        "password": login.get("password"),
        "username": login.get("username"),
        "totp": login.get("totp"),
        "uri": (uris[0] or {}).get("uri") if uris else None,
        "notes": item.get("notes"),
    }
    custom_fields = item.get("fields") or []

    def custom(name: str) -> Optional[str]:
        for f in custom_fields:
            if f.get("name") == name:
                value = f.get("value")
                return None if value is None else str(value)
        return None

    if not field:
        if item.get("type") == LOGIN and built_in["password"]:
            return str(built_in["password"])
        if item.get("type") == SECURE_NOTE and built_in["notes"]:
            return str(built_in["notes"])
        raise ValueError(f'[vaultwarden] item "{path}" has no password or notes to return; name a field with #')

    if field.startswith("fields."):
        value = custom(field[len("fields.") :])
        if value is not None:
            return value
    else:
        if built_in.get(field):
            return str(built_in[field])
        value = custom(field)
        if value is not None:
            return value
        notes = item.get("notes")
        if notes:
            try:
                json.loads(notes)
                return extract_field(notes, field, provider="vaultwarden", path=path)
            except ValueError:
                pass  # not JSON, or no such key - fall through to the error below

    available = [f for f in BUILT_IN_FIELDS if built_in.get(f)] + [
        f["name"] for f in custom_fields if f.get("name")
    ]
    has = f" (it has: {', '.join(available)})" if available else ""
    raise ValueError(f'[vaultwarden] field "{field}" not found in item "{path}"{has}')
