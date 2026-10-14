import { describe, expect, it, vi } from "vitest";
import { VaultwardenProvider, type BwRunner } from "../src/providers/vaultwarden.js";
import { SecretFetchError } from "../src/providers/base.js";
import { buildProviders, parseConfig } from "../src/config.js";

const STRIPE_ID = "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d";

const ITEMS = [
  {
    id: STRIPE_ID,
    name: "stripe",
    type: 1,
    folderId: "f-prod",
    notes: null,
    login: { username: "ops@example.com", password: "sk-prod-value", totp: null, uris: [{ uri: "https://stripe.com" }] },
    fields: [{ name: "webhook_secret", value: "whsec-prod-value" }],
  },
  {
    id: "6ec0bd7f-11c0-43da-975e-2a8ad9ebae0b",
    name: "stripe",
    type: 1,
    folderId: "f-staging",
    login: { username: "ops@example.com", password: "sk-staging-value" },
  },
  {
    id: "1f0c8d2e-0000-4000-8000-000000000003",
    name: "db-config",
    type: 2,
    notes: JSON.stringify({ host: "db.internal", password: "pg-value" }),
  },
  { id: "1f0c8d2e-0000-4000-8000-000000000004", name: "stripe-legacy", type: 1, login: { password: "old" } },
];
const FOLDERS = [
  { id: "f-prod", name: "prod" },
  { id: "f-staging", name: "staging" },
];

function ok(data: unknown) {
  return { stdout: JSON.stringify({ success: true, data }), stderr: "", code: 0 };
}
function fail(message: string) {
  return { stdout: JSON.stringify({ success: false, message }), stderr: "", code: 1 };
}

/** A stand-in for the bw CLI, answering as `bw --response` does. */
function fakeBw(overrides: { status?: string; serverUrl?: string } = {}) {
  const calls: { args: string[]; env: NodeJS.ProcessEnv }[] = [];
  const run: BwRunner = vi.fn(async (argv: string[], env: NodeJS.ProcessEnv) => {
    const args = argv.filter((a) => !a.startsWith("--") || a === "--search");
    calls.push({ args, env });
    if (env.BW_SESSION !== "session-key") return fail("Vault is locked.");
    const [cmd, what, ...rest] = args;
    const search = rest.includes("--search") ? (rest[rest.indexOf("--search") + 1] ?? "") : "";
    switch (cmd) {
      case "status":
        return ok({
          object: "template",
          template: { serverUrl: overrides.serverUrl ?? "https://vault.example.com", status: overrides.status ?? "unlocked" },
        });
      case "sync":
        return ok({ object: "message", title: "Syncing complete." });
      case "get": {
        const item = ITEMS.find((i) => i.id === rest[0]);
        return item ? ok(item) : fail("Not found.");
      }
      case "list":
        // bw's search is a substring match, which is why the provider
        // filters for an exact name.
        return what === "folders"
          ? ok({ object: "list", data: FOLDERS.filter((f) => f.name.includes(search)) })
          : ok({ object: "list", data: ITEMS.filter((i) => i.name.includes(search)) });
      default:
        return fail(`unknown command ${cmd}`);
    }
  });
  return { run, calls };
}

function provider(opts: ConstructorParameters<typeof VaultwardenProvider>[0] = {}) {
  const fake = fakeBw();
  return { fake, p: new VaultwardenProvider({ session: "session-key", run: fake.run, ...opts }) };
}

describe("VaultwardenProvider", () => {
  it("returns a login's password by default, by item id", async () => {
    const { p } = provider();
    expect(await p.fetchOne({ path: STRIPE_ID })).toBe("sk-prod-value");
  });

  it("reads built-in parts and custom fields", async () => {
    const { p } = provider();
    expect(await p.fetchOne({ path: STRIPE_ID, field: "username" })).toBe("ops@example.com");
    expect(await p.fetchOne({ path: STRIPE_ID, field: "uri" })).toBe("https://stripe.com");
    expect(await p.fetchOne({ path: STRIPE_ID, field: "webhook_secret" })).toBe("whsec-prod-value");
    expect(await p.fetchOne({ path: STRIPE_ID, field: "fields.webhook_secret" })).toBe("whsec-prod-value");
  });

  it("reads keys out of a secure note that holds JSON", async () => {
    const { p } = provider();
    expect(await p.fetchOne({ path: "db-config", field: "password" })).toBe("pg-value");
    expect(await p.fetchOne({ path: "db-config" })).toContain("db.internal");
  });

  it("matches names exactly, never by bw's substring search", async () => {
    const { p } = provider();
    // "stripe-legacy" contains "legacy"; a substring match would return it.
    await expect(p.fetchOne({ path: "legacy" })).rejects.toMatchObject({ kind: "not_found" });
  });

  it("refuses an ambiguous name, and resolves it qualified by folder", async () => {
    const { p } = provider();
    await expect(p.fetchOne({ path: "stripe" })).rejects.toThrow(/2 items are named "stripe"/);
    expect(await p.fetchOne({ path: "prod/stripe" })).toBe("sk-prod-value");
    expect(await p.fetchOne({ path: "staging/stripe" })).toBe("sk-staging-value");
  });

  it("names the fields an item has, never their values, when one is missing", async () => {
    const { p } = provider();
    const err = await p.fetchOne({ path: STRIPE_ID, field: "nope" }).catch((e: Error) => e);
    expect(String(err)).toMatch(/field "nope" not found .*password, username, uri, webhook_secret/);
    expect(String(err)).not.toContain("sk-prod-value");
  });

  it("hands the session to bw through the environment, never as an argument", async () => {
    const { p, fake } = provider();
    await p.fetchOne({ path: STRIPE_ID });
    for (const call of fake.calls) {
      expect(call.env.BW_SESSION).toBe("session-key");
      expect(call.env.BW_NOINTERACTION).toBe("true");
      expect(call.args.join(" ")).not.toContain("session-key");
    }
    const argv = (fake.run as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string[];
    expect(argv).toContain("--nointeraction");
  });

  it("checks status and syncs once, then reuses that across fetches", async () => {
    const { p, fake } = provider();
    await Promise.all([p.fetchOne({ path: STRIPE_ID }), p.fetchOne({ path: STRIPE_ID, field: "username" })]);
    await p.fetchOne({ path: "prod/stripe" });
    const commands = fake.calls.map((c) => c.args[0]);
    expect(commands.filter((c) => c === "status")).toHaveLength(1);
    expect(commands.filter((c) => c === "sync")).toHaveLength(1);
    // Two references to one item, fetched together, run bw for it once.
    expect(fake.calls.filter((c) => c.args[0] === "get")).toHaveLength(1);
  });

  it("skips the sync when asked to", async () => {
    const { p, fake } = provider({ sync: false });
    await p.fetchOne({ path: STRIPE_ID });
    expect(fake.calls.map((c) => c.args[0])).not.toContain("sync");
  });

  it("reports a missing or locked session as an auth failure, with the fix", async () => {
    const { fake } = provider();
    const noSession = new VaultwardenProvider({ session: undefined, run: fake.run });
    const err = (await noSession.fetchOne({ path: STRIPE_ID }).catch((e) => e)) as SecretFetchError;
    expect(err.kind).toBe("auth");
    expect(err.remedy).toMatch(/bw unlock --raw/);

    const wrong = new VaultwardenProvider({ session: "expired", run: fake.run });
    expect(((await wrong.fetchOne({ path: STRIPE_ID }).catch((e) => e)) as SecretFetchError).kind).toBe("auth");

    const locked = new VaultwardenProvider({ session: "session-key", run: fakeBw({ status: "locked" }).run });
    expect(((await locked.fetchOne({ path: STRIPE_ID }).catch((e) => e)) as SecretFetchError).kind).toBe("auth");
  });

  it("refuses a bw logged in to a different server than the alias expects", async () => {
    const run = fakeBw({ serverUrl: "https://vault.bitwarden.com" }).run;
    const p = new VaultwardenProvider({ session: "session-key", serverUrl: "https://vault.example.com/", run });
    await expect(p.fetchOne({ path: STRIPE_ID })).rejects.toThrow(/logged in to https:\/\/vault.bitwarden.com/);
    const right = new VaultwardenProvider({ session: "session-key", serverUrl: "https://VAULT.example.com/", run: fakeBw().run });
    expect(await right.fetchOne({ path: STRIPE_ID })).toBe("sk-prod-value");
  });

  it("classifies a missing item id as not found", async () => {
    const { p } = provider();
    const err = (await p.fetchOne({ path: "00000000-0000-4000-8000-000000000000" }).catch((e) => e)) as SecretFetchError;
    expect(err.kind).toBe("not_found");
  });

  it("explains a missing bw binary", async () => {
    const enoent: BwRunner = async () => {
      throw Object.assign(new Error("spawn bw ENOENT"), { code: "ENOENT" });
    };
    const p = new VaultwardenProvider({ session: "session-key", run: enoent });
    await expect(p.fetchOne({ path: STRIPE_ID })).rejects.toThrow(/npm install -g @bitwarden\/cli/);
  });

  it("health check reports the server and never the account", async () => {
    const { p } = provider();
    expect(await p.healthCheck()).toEqual({ provider: "vaultwarden", ok: true, message: "unlocked, https://vault.example.com" });
  });
});

describe("vaultwarden in secrefs.config.json", () => {
  it("builds a provider from sessionEnv, and refuses an inline session", () => {
    const config = parseConfig(
      JSON.stringify({ providers: { vw: { type: "vaultwarden", sessionEnv: "BW_SESSION_ENG", serverUrl: "https://vault.example.com" } } }),
    );
    const registry = buildProviders(config, { env: { BW_SESSION_ENG: "s" } });
    expect(registry.vw).toBeInstanceOf(VaultwardenProvider);
    expect(() => buildProviders(config, { env: {} })).toThrow(/BW_SESSION_ENG/);
    expect(() =>
      parseConfig(JSON.stringify({ providers: { vw: { type: "vaultwarden", session: "s" } } })),
    ).toThrow(/must never contain a credential/);
  });
});
