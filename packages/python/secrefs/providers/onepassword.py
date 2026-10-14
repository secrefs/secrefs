"""
1Password, through its official SDK. Mirrors
packages/node/src/providers/onepassword.ts.

Authenticates with a service account token (non-interactive; CI and agents)
or, with `account`, through the 1Password desktop app, which asks the person
at the keyboard to approve - Touch ID, Windows Hello or their system
password. A service account sees only the vaults it was granted, and a vault
it can't see is reported as not found.

References requested together are resolved in one `resolve_all` call: every
reference in a `.env` is fetched at once, and service accounts are
rate-limited per request.

`onepassword-sdk` is an optional extra (`pip install 'secrefs[1password]'`)
for the same reason `bitwarden-sdk` is: it ships only prebuilt native wheels
for a fixed set of platforms. It is imported at first use.
"""

from __future__ import annotations

import asyncio
import os
import re
from enum import Enum
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import unquote

from .base import ProviderHealth, SecretFetchRequest, SecretProvider

INTEGRATION_NAME = "SecRefs"
INTEGRATION_VERSION = "1"
DEFAULT_FIELD = "password"

NOT_FOUND = {"vaultNotFound", "itemNotFound", "fieldNotFound", "noMatchingSections"}
AMBIGUOUS = {
    "tooManyVaults": "more than one vault matches",
    "tooManyItems": "more than one item matches; use the item id",
    "tooManyMatchingFields": "more than one field matches; qualify it with its section",
}
TRANSIENT = re.compile(r"timed? ?out|network|connect|getaddrinfo|econn", re.IGNORECASE)


class OnePasswordAuthError(ValueError):
    """Missing, malformed, revoked or expired credentials, or a desktop app
    that is locked or not set up to integrate. Not the reference's fault."""


class OnePasswordNotFoundError(ValueError):
    pass


def to_op_reference(path: str, field: Optional[str]) -> str:
    """
    `Prod/Stripe#api_key`  -> `op://Prod/Stripe/api_key`
    `Prod/Stripe/Live#key` -> `op://Prod/Stripe/Live/key` (section "Live")
    `Prod/Stripe/api_key`  -> `op://Prod/Stripe/api_key`
    `Prod/Stripe`          -> `op://Prod/Stripe/password`

    Names with spaces are written percent-encoded (`My%20Vault`). The field
    is used verbatim: `#a.b` is not a JSON path here.
    """
    segments: List[str] = []
    for segment in path.split("/"):
        decoded = unquote(segment, errors="strict") if "%" in segment else segment
        if not decoded or "/" in decoded:
            raise ValueError(f'"{path}" has an empty segment, or one that decodes to a "/"')
        segments.append(decoded)

    if field:
        parts = [*segments, field]
    elif len(segments) == 2:
        parts = [*segments, DEFAULT_FIELD]
    else:
        parts = segments
    if not 3 <= len(parts) <= 4:
        shown = f"{path}#{field}" if field else path
        raise ValueError(
            f'"{shown}" must name <vault>/<item>[/<section>] and a field, '
            "e.g. sec://1password/Prod/Stripe#api_key"
        )
    return "op://" + "/".join(parts)


class OnePasswordProvider(SecretProvider):
    name = "1password"

    def __init__(
        self,
        service_account_token: Optional[str] = None,
        account: Optional[str] = None,
        client: Optional[Any] = None,
    ) -> None:
        self._token = (
            service_account_token
            if service_account_token is not None
            else os.environ.get("OP_SERVICE_ACCOUNT_TOKEN")
        )
        self._account = account if account is not None else os.environ.get("OP_ACCOUNT")
        self._explicit_client = client
        self._client: Optional["asyncio.Future[Any]"] = None
        self._queue: List[Tuple[str, "asyncio.Future[str]"]] = []
        self._flush_scheduled = False

    def _how(self) -> str:
        return "service account token" if self._token else f'desktop app, account "{self._account}"'

    async def _create_client(self) -> Any:
        if self._explicit_client is not None:
            return self._explicit_client
        if not self._token and not self._account:
            raise OnePasswordAuthError(
                "neither OP_SERVICE_ACCOUNT_TOKEN nor OP_ACCOUNT is set "
                "(required for sec://1password/... references)"
            )
        try:
            import onepassword
        except ImportError as exc:
            raise ValueError(
                "sec://1password/... references need the 1Password SDK: "
                "pip install 'secrefs[1password]'"
            ) from exc

        auth: Any = self._token or onepassword.DesktopAuth(self._account)
        try:
            return await onepassword.Client.authenticate(
                auth=auth,
                integration_name=INTEGRATION_NAME,
                integration_version=INTEGRATION_VERSION,
            )
        except Exception as exc:  # noqa: BLE001
            raise _classify(exc, self._how(), unknown_is_auth=True) from exc

    async def _get_client(self) -> Any:
        if self._client is None:
            self._client = asyncio.ensure_future(self._create_client())
        try:
            return await asyncio.shield(self._client)
        except BaseException:
            self._client = None  # let the next call try again
            raise

    async def fetch_one(self, request: SecretFetchRequest) -> str:
        reference = to_op_reference(request.path, request.field)
        loop = asyncio.get_running_loop()
        future: "asyncio.Future[str]" = loop.create_future()
        self._queue.append((reference, future))
        if not self._flush_scheduled:
            self._flush_scheduled = True
            # Every fetch_one started before the loop next runs - the
            # resolver gathers them all at once - joins one resolve_all.
            loop.call_soon(lambda: asyncio.ensure_future(self._flush()))
        return await future

    async def _flush(self) -> None:
        batch, self._queue = self._queue, []
        self._flush_scheduled = False
        try:
            client = await self._get_client()
            unique = list(dict.fromkeys(reference for reference, _ in batch))
            response = await client.secrets.resolve_all(unique)
            responses: Dict[str, Any] = response.individual_responses
        except Exception as exc:  # noqa: BLE001
            failure = exc if isinstance(exc, (OnePasswordAuthError, ValueError)) else _classify(exc, "request")
            for _, future in batch:
                if not future.done():
                    future.set_exception(failure)
            return

        for reference, future in batch:
            if future.done():
                continue
            item = responses.get(reference)
            content = getattr(item, "content", None)
            if content is not None:
                future.set_result(content.secret)
            else:
                future.set_exception(_reference_error(reference, getattr(item, "error", None)))

    async def health_check(self) -> ProviderHealth:
        try:
            await self._get_client()
            message = "service account" if self._token else self._how()
            return ProviderHealth(provider=self.name, ok=True, message=message)
        except Exception as exc:  # noqa: BLE001
            return ProviderHealth(provider=self.name, ok=False, message=str(exc))


def _type_of(error: Any) -> str:
    kind = getattr(error, "type", None) or "other"
    return str(kind.value) if isinstance(kind, Enum) else str(kind)


def _reference_error(reference: str, error: Any) -> ValueError:
    kind = _type_of(error)
    label = reference[len("op://") :]
    if kind in NOT_FOUND:
        what = "section" if kind == "noMatchingSections" else kind.replace("NotFound", "")
        return OnePasswordNotFoundError(f'{what} not found for "{label}" (or the account can\'t see that vault)')
    if kind in AMBIGUOUS:
        return ValueError(f'"{label}": {AMBIGUOUS[kind]}')
    message = getattr(error, "message", None)
    return ValueError(f'"{label}": {kind}' + (f" - {message}" if message else ""))


def _classify(exc: BaseException, how: str, unknown_is_auth: bool = False) -> ValueError:
    kind = type(exc).__name__
    message = str(exc)
    if kind in ("DesktopSessionExpiredException", "AuthExpiredException"):
        return OnePasswordAuthError(f"1Password session expired ({how}): {message}")
    if kind == "RateLimitExceededException":
        return ValueError(f"1Password rate limit exceeded: {message}")
    if unknown_is_auth and not TRANSIENT.search(message):
        return OnePasswordAuthError(f"could not authenticate with 1Password ({how}): {message}")
    return ValueError(f"1Password {how} failed: {message}")
