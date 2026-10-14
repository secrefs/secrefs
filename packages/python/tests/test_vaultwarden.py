import asyncio
import json
from typing import Any, Dict, List, Optional, Tuple

import pytest

from secrefs import create_default_providers
from secrefs.providers.base import SecretFetchRequest
from secrefs.providers.vaultwarden import (
    VaultwardenAuthError,
    VaultwardenNotFoundError,
    VaultwardenProvider,
)

STRIPE_ID = "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d"

ITEMS: List[Dict[str, Any]] = [
    {
        "id": STRIPE_ID,
        "name": "stripe",
        "type": 1,
        "folderId": "f-prod",
        "login": {"username": "ops@example.com", "password": "sk-prod-value", "uris": [{"uri": "https://stripe.com"}]},
        "fields": [{"name": "webhook_secret", "value": "whsec-prod-value"}],
    },
    {
        "id": "6ec0bd7f-11c0-43da-975e-2a8ad9ebae0b",
        "name": "stripe",
        "type": 1,
        "folderId": "f-staging",
        "login": {"password": "sk-staging-value"},
    },
    {
        "id": "1f0c8d2e-0000-4000-8000-000000000003",
        "name": "db-config",
        "type": 2,
        "notes": json.dumps({"host": "db.internal", "password": "pg-value"}),
    },
    {"id": "1f0c8d2e-0000-4000-8000-000000000004", "name": "stripe-legacy", "type": 1, "login": {"password": "old"}},
]
FOLDERS = [{"id": "f-prod", "name": "prod"}, {"id": "f-staging", "name": "staging"}]


def ok(data: Any) -> Tuple[str, str, int]:
    return json.dumps({"success": True, "data": data}), "", 0


def fail(message: str) -> Tuple[str, str, int]:
    return json.dumps({"success": False, "message": message}), "", 1


class FakeBw:
    """Answers as `bw --response` does. bw's --search is a substring match,
    which is why the provider filters for exact names."""

    def __init__(self, status: str = "unlocked", server_url: str = "https://vault.example.com") -> None:
        self.status = status
        self.server_url = server_url
        self.calls: List[Tuple[List[str], Dict[str, str]]] = []

    async def __call__(self, argv: List[str], env: Dict[str, str]) -> Tuple[str, str, Optional[int]]:
        args = [a for a in argv if not a.startswith("--") or a == "--search"]
        self.calls.append((args, env))
        if env.get("BW_SESSION") != "session-key":
            return fail("Vault is locked.")
        cmd, rest = args[0], args[1:]
        search = rest[rest.index("--search") + 1] if "--search" in rest else ""
        if cmd == "status":
            return ok({"object": "template", "template": {"serverUrl": self.server_url, "status": self.status}})
        if cmd == "sync":
            return ok({"object": "message"})
        if cmd == "get":
            item = next((i for i in ITEMS if i["id"] == rest[1]), None)
            return ok(item) if item else fail("Not found.")
        if cmd == "list" and rest[0] == "folders":
            return ok({"object": "list", "data": [f for f in FOLDERS if search in f["name"]]})
        if cmd == "list":
            return ok({"object": "list", "data": [i for i in ITEMS if search in i["name"]]})
        return fail(f"unknown command {cmd}")

    def commands(self) -> List[str]:
        return [args[0] for args, _ in self.calls]


def provider(**kwargs: Any) -> Tuple[VaultwardenProvider, FakeBw]:
    fake = kwargs.pop("fake", None) or FakeBw()
    return VaultwardenProvider(session=kwargs.pop("session", "session-key"), run=fake, **kwargs), fake


async def fetch(p: VaultwardenProvider, path: str, field: Optional[str] = None) -> str:
    return await p.fetch_one(SecretFetchRequest(path=path, field=field))


async def test_returns_a_logins_password_by_default_by_item_id():
    p, _ = provider()
    assert await fetch(p, STRIPE_ID) == "sk-prod-value"


async def test_reads_built_in_parts_and_custom_fields():
    p, _ = provider()
    assert await fetch(p, STRIPE_ID, "username") == "ops@example.com"
    assert await fetch(p, STRIPE_ID, "uri") == "https://stripe.com"
    assert await fetch(p, STRIPE_ID, "webhook_secret") == "whsec-prod-value"
    assert await fetch(p, STRIPE_ID, "fields.webhook_secret") == "whsec-prod-value"


async def test_reads_keys_out_of_a_secure_note_that_holds_json():
    p, _ = provider()
    assert await fetch(p, "db-config", "password") == "pg-value"


async def test_matches_names_exactly_and_qualifies_by_folder():
    p, _ = provider()
    with pytest.raises(VaultwardenNotFoundError):
        await fetch(p, "legacy")
    with pytest.raises(ValueError, match='2 items are named "stripe"'):
        await fetch(p, "stripe")
    assert await fetch(p, "prod/stripe") == "sk-prod-value"
    assert await fetch(p, "staging/stripe") == "sk-staging-value"


async def test_names_fields_but_never_values_when_one_is_missing():
    p, _ = provider()
    with pytest.raises(ValueError) as exc:
        await fetch(p, STRIPE_ID, "nope")
    assert "password, username, uri, webhook_secret" in str(exc.value)
    assert "sk-prod-value" not in str(exc.value)


async def test_session_goes_through_the_environment_never_argv():
    p, fake = provider()
    await fetch(p, STRIPE_ID)
    for args, env in fake.calls:
        assert env["BW_SESSION"] == "session-key"
        assert env["BW_NOINTERACTION"] == "true"
        assert "session-key" not in " ".join(args)


async def test_checks_status_and_syncs_once_and_dedupes_one_item():
    p, fake = provider()
    await asyncio.gather(fetch(p, STRIPE_ID), fetch(p, STRIPE_ID, "username"))
    await fetch(p, "prod/stripe")
    assert fake.commands().count("status") == 1
    assert fake.commands().count("sync") == 1
    assert fake.commands().count("get") == 1


async def test_missing_or_locked_session_is_an_auth_error():
    with pytest.raises(VaultwardenAuthError, match="bw unlock --raw"):
        await fetch(provider(session="")[0], STRIPE_ID)
    with pytest.raises(VaultwardenAuthError):
        await fetch(provider(session="expired")[0], STRIPE_ID)
    with pytest.raises(VaultwardenAuthError):
        await fetch(provider(fake=FakeBw(status="locked"))[0], STRIPE_ID)


async def test_refuses_a_bw_logged_in_to_another_server():
    p, _ = provider(server_url="https://vault.example.com/", fake=FakeBw(server_url="https://vault.bitwarden.com"))
    with pytest.raises(VaultwardenAuthError, match="logged in to https://vault.bitwarden.com"):
        await fetch(p, STRIPE_ID)
    right, _ = provider(server_url="https://VAULT.example.com/")
    assert await fetch(right, STRIPE_ID) == "sk-prod-value"


async def test_health_check_reports_the_server():
    p, _ = provider()
    health = await p.health_check()
    assert health.ok and health.message == "unlocked, https://vault.example.com"


def test_is_a_default_alias():
    assert isinstance(create_default_providers()["vaultwarden"], VaultwardenProvider)
