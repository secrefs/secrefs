import asyncio
from types import SimpleNamespace
from typing import Any, Dict, List

import pytest

from secrefs import SecRefs, create_default_providers
from secrefs.providers.base import SecretFetchRequest
from secrefs.providers.onepassword import (
    OnePasswordAuthError,
    OnePasswordNotFoundError,
    OnePasswordProvider,
    to_op_reference,
)

VAULT = {
    "op://Prod/Stripe/api_key": "sk-prod-value",
    "op://Prod/Stripe/password": "stripe-login-value",
    "op://Prod/Stripe/Live/webhook": "whsec-value",
    "op://My Vault/DB/password": "pg-value",
}


class FakeSecrets:
    def __init__(self, errors: Dict[str, str]) -> None:
        self.errors = errors
        self.calls: List[List[str]] = []

    async def resolve_all(self, refs: List[str]) -> Any:
        self.calls.append(refs)
        responses = {
            r: SimpleNamespace(content=SimpleNamespace(secret=VAULT[r]), error=None)
            if r in VAULT
            else SimpleNamespace(content=None, error=SimpleNamespace(type=self.errors.get(r, "itemNotFound"), message=None))
            for r in refs
        }
        return SimpleNamespace(individual_responses=responses)


def provider(**errors: str) -> "tuple[OnePasswordProvider, FakeSecrets]":
    secrets = FakeSecrets({"op://" + k.replace("__", "/"): v for k, v in errors.items()})
    return OnePasswordProvider(client=SimpleNamespace(secrets=secrets)), secrets


def test_maps_paths_and_fields_onto_op_references():
    assert to_op_reference("Prod/Stripe", "api_key") == "op://Prod/Stripe/api_key"
    assert to_op_reference("Prod/Stripe/Live", "webhook") == "op://Prod/Stripe/Live/webhook"
    assert to_op_reference("Prod/Stripe/api_key", None) == "op://Prod/Stripe/api_key"
    assert to_op_reference("Prod/Stripe", None) == "op://Prod/Stripe/password"
    assert to_op_reference("My%20Vault/DB", None) == "op://My Vault/DB/password"
    for bad in [("Prod", None), ("Prod/Stripe/Live/x", "y"), ("Prod/a%2Fb", "x")]:
        with pytest.raises(ValueError):
            to_op_reference(*bad)


async def test_resolves_fields_sections_and_the_default_field():
    p, _ = provider()
    assert await p.fetch_one(SecretFetchRequest("Prod/Stripe", "api_key")) == "sk-prod-value"
    assert await p.fetch_one(SecretFetchRequest("Prod/Stripe/Live", "webhook")) == "whsec-value"
    assert await p.fetch_one(SecretFetchRequest("Prod/Stripe")) == "stripe-login-value"
    assert await p.fetch_one(SecretFetchRequest("My%20Vault/DB")) == "pg-value"


async def test_resolves_a_whole_env_in_one_call_deduplicated():
    p, secrets = provider()
    out = await SecRefs(providers={"1password": p}).expand_env(
        {
            "A": "sec://1password/Prod/Stripe#api_key",
            "B": "sec://1password/Prod/Stripe/Live#webhook",
            "C": "sec://1password/Prod/Stripe/api_key",
        }
    )
    assert out == {"A": "sk-prod-value", "B": "whsec-value", "C": "sk-prod-value"}
    assert secrets.calls == [["op://Prod/Stripe/api_key", "op://Prod/Stripe/Live/webhook"]]


async def test_classifies_missing_and_ambiguous_references():
    p, _ = provider(**{"Prod__Twins__password": "tooManyItems"})
    with pytest.raises(OnePasswordNotFoundError, match=r'item not found for "Prod/Gone/password"'):
        await p.fetch_one(SecretFetchRequest("Prod/Gone"))
    with pytest.raises(ValueError, match="more than one item matches"):
        await p.fetch_one(SecretFetchRequest("Prod/Twins"))


async def test_one_failure_does_not_fail_its_batch():
    p, _ = provider()
    ok, bad = await asyncio.gather(
        p.fetch_one(SecretFetchRequest("Prod/Stripe", "api_key")),
        p.fetch_one(SecretFetchRequest("Prod/Gone", "x")),
        return_exceptions=True,
    )
    assert ok == "sk-prod-value"
    assert isinstance(bad, OnePasswordNotFoundError)


async def test_missing_credentials_are_an_auth_error():
    p = OnePasswordProvider(service_account_token="", account="")
    with pytest.raises(OnePasswordAuthError, match="OP_SERVICE_ACCOUNT_TOKEN"):
        await p.fetch_one(SecretFetchRequest("Prod/Stripe"))
    assert not (await p.health_check()).ok


async def test_a_malformed_token_is_an_auth_error_with_the_real_sdk():
    pytest.importorskip("onepassword")
    p = OnePasswordProvider(service_account_token="ops_" + "not-a-real-token")
    with pytest.raises(OnePasswordAuthError, match=r"service account token") as exc:
        await p.fetch_one(SecretFetchRequest("Prod/Stripe"))
    assert "not-a-real-token" not in str(exc.value)


def test_is_a_default_alias():
    assert isinstance(create_default_providers()["1password"], OnePasswordProvider)
