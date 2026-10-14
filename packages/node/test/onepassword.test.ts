import { describe, expect, it, vi } from "vitest";
import { Secrets } from "@1password/sdk";
import {
  OnePasswordProvider,
  toOpReference,
  type OnePasswordClientLike,
} from "../src/providers/onepassword.js";
import type { SecretFetchError } from "../src/providers/base.js";
import { buildProviders, parseConfig } from "../src/config.js";
import { SecRefs } from "../src/index.js";

const VAULT: Record<string, string> = {
  "op://Prod/Stripe/api_key": "sk-prod-value",
  "op://Prod/Stripe/password": "stripe-login-value",
  "op://Prod/Stripe/Live/webhook": "whsec-value",
  "op://My Vault/DB/password": "pg-value",
};

function fakeClient(errors: Record<string, { type: string; message?: string }> = {}) {
  const resolveAll = vi.fn(async (refs: string[]) => ({
    individualResponses: Object.fromEntries(
      refs.map((r) => [
        r,
        VAULT[r] !== undefined ? { content: { secret: VAULT[r] } } : { error: errors[r] ?? { type: "itemNotFound" } },
      ]),
    ),
  }));
  const client: OnePasswordClientLike = { secrets: { resolveAll } };
  return { client, resolveAll };
}

describe("toOpReference", () => {
  it("maps paths and fields onto op:// references", () => {
    expect(toOpReference("Prod/Stripe", "api_key")).toBe("op://Prod/Stripe/api_key");
    expect(toOpReference("Prod/Stripe/Live", "webhook")).toBe("op://Prod/Stripe/Live/webhook");
    expect(toOpReference("Prod/Stripe/api_key", undefined)).toBe("op://Prod/Stripe/api_key");
    expect(toOpReference("Prod/Stripe", undefined)).toBe("op://Prod/Stripe/password");
    expect(toOpReference("My%20Vault/DB", undefined)).toBe("op://My Vault/DB/password");
  });

  it("refuses references that can't name a field", () => {
    expect(() => toOpReference("Prod", undefined)).toThrow(/<vault>\/<item>/);
    expect(() => toOpReference("Prod/Stripe/Live/x", "y")).toThrow(/<vault>\/<item>/);
    expect(() => toOpReference("Prod/a%2Fb", "x")).toThrow(/decodes to a "\/"/);
    expect(() => toOpReference("Prod/%zz", "x")).toThrow(/percent-encoding/);
  });

  it("produces references the real SDK accepts", () => {
    for (const ref of ["op://Prod/Stripe/api_key", toOpReference("Prod/Stripe/Live", "webhook"), toOpReference("My%20Vault/DB", undefined)]) {
      expect(() => Secrets.validateSecretReference(ref)).not.toThrow();
    }
  });
});

describe("OnePasswordProvider", () => {
  it("resolves fields, sections and the default password field", async () => {
    const { client } = fakeClient();
    const p = new OnePasswordProvider({ client });
    expect(await p.fetchOne({ path: "Prod/Stripe", field: "api_key" })).toBe("sk-prod-value");
    expect(await p.fetchOne({ path: "Prod/Stripe/Live", field: "webhook" })).toBe("whsec-value");
    expect(await p.fetchOne({ path: "Prod/Stripe" })).toBe("stripe-login-value");
    expect(await p.fetchOne({ path: "My%20Vault/DB" })).toBe("pg-value");
  });

  it("resolves a whole .env in one resolveAll call, deduplicated", async () => {
    const { client, resolveAll } = fakeClient();
    const secRefs = new SecRefs({ providers: { "1password": new OnePasswordProvider({ client }) } });
    const out = await secRefs.expandEnv({
      A: "sec://1password/Prod/Stripe#api_key",
      B: "sec://1password/Prod/Stripe/Live#webhook",
      C: "sec://1password/Prod/Stripe/api_key",
      D: "plain",
    });
    expect(out).toEqual({ A: "sk-prod-value", B: "whsec-value", C: "sk-prod-value", D: "plain" });
    expect(resolveAll).toHaveBeenCalledTimes(1);
    expect(resolveAll.mock.calls[0]?.[0]).toEqual(["op://Prod/Stripe/api_key", "op://Prod/Stripe/Live/webhook"]);
  });

  it("classifies missing and ambiguous references without echoing values", async () => {
    const { client } = fakeClient({
      "op://Prod/Twins/password": { type: "tooManyItems" },
      "op://Nope/X/password": { type: "vaultNotFound" },
    });
    const p = new OnePasswordProvider({ client });
    const missing = (await p.fetchOne({ path: "Prod/Gone" }).catch((e) => e)) as SecretFetchError;
    expect(missing.kind).toBe("not_found");
    expect(missing.message).toMatch(/item not found for "Prod\/Gone\/password"/);
    const vault = (await p.fetchOne({ path: "Nope/X" }).catch((e) => e)) as SecretFetchError;
    expect(vault.message).toMatch(/vault not found .*can't see that vault/);
    await expect(p.fetchOne({ path: "Prod/Twins" })).rejects.toThrow(/more than one item matches; use the item id/);
  });

  it("one failed reference doesn't fail the others in its batch", async () => {
    const { client } = fakeClient();
    const p = new OnePasswordProvider({ client });
    const [ok, bad] = await Promise.allSettled([
      p.fetchOne({ path: "Prod/Stripe", field: "api_key" }),
      p.fetchOne({ path: "Prod/Gone", field: "x" }),
    ]);
    expect(ok).toEqual({ status: "fulfilled", value: "sk-prod-value" });
    expect(bad.status).toBe("rejected");
  });

  it("reports missing credentials as an auth failure, with the fix", async () => {
    const p = new OnePasswordProvider({ serviceAccountToken: "", account: "" });
    const err = (await p.fetchOne({ path: "Prod/Stripe" }).catch((e) => e)) as SecretFetchError;
    expect(err.kind).toBe("auth");
    expect(err.remedy).toMatch(/OP_SERVICE_ACCOUNT_TOKEN/);
    expect((await p.healthCheck()).ok).toBe(false);
  });

  it("reports a malformed service account token as an auth failure (real SDK)", async () => {
    const p = new OnePasswordProvider({ serviceAccountToken: "ops_" + "not-a-real-token" });
    const err = (await p.fetchOne({ path: "Prod/Stripe" }).catch((e) => e)) as SecretFetchError;
    expect(err.kind).toBe("auth");
    expect(err.message).toMatch(/could not authenticate with 1Password \(service account token\)/);
    expect(err.message).not.toContain("not-a-real-token");
  });

  it("recasts the SDK's rate-limit and expiry errors", async () => {
    class RateLimitExceededError extends Error {}
    class AuthExpiredError extends Error {}
    for (const [Thrown, kind] of [
      [RateLimitExceededError, "transient"],
      [AuthExpiredError, "auth"],
    ] as const) {
      const client: OnePasswordClientLike = {
        secrets: { resolveAll: async () => Promise.reject(new Thrown("from the SDK")) },
      };
      const err = (await new OnePasswordProvider({ client }).fetchOne({ path: "Prod/Stripe" }).catch((e) => e)) as SecretFetchError;
      expect(err.kind).toBe(kind);
    }
  });
});

describe("1password in secrefs.config.json", () => {
  it("uses tokenEnv, or the desktop app when only an account is named", () => {
    const config = parseConfig(
      JSON.stringify({
        providers: {
          "op-ci": { type: "1password", tokenEnv: "OP_TOKEN_CI" },
          "op-me": { type: "1password", account: "my-team" },
        },
      }),
    );
    expect(() => buildProviders(config, { env: {} })).toThrow(/OP_TOKEN_CI/);
    const registry = buildProviders(config, { env: { OP_TOKEN_CI: "t", OP_SERVICE_ACCOUNT_TOKEN: "ignored" } });
    expect(registry["op-ci"]).toBeInstanceOf(OnePasswordProvider);
    // Inspected rather than health-checked: a real check would ask the
    // 1Password app on this machine for approval.
    const desktop = registry["op-me"] as unknown as { token?: string; account?: string };
    expect(desktop.token).toBe("");
    expect(desktop.account).toBe("my-team");
    expect(() => parseConfig(JSON.stringify({ providers: { op: { type: "1password", token: "x" } } }))).toThrow(
      /must never contain a credential/,
    );
  });
});
