import { spawn } from "node:child_process";
import {
  BaseSecretProvider,
  SecretFetchError,
  errorMessage,
  extractField,
  type ProviderHealth,
  type SecretFetchRequest,
} from "./base.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Item types, as the Bitwarden CLI numbers them. */
const LOGIN = 1;
const SECURE_NOTE = 2;

/** Runs one `bw` command. Injected in tests; the default spawns the CLI. */
export type BwRunner = (
  args: string[],
  env: NodeJS.ProcessEnv,
) => Promise<{ stdout: string; stderr: string; code: number | null }>;

export interface VaultwardenProviderOptions {
  /** Session key from `bw unlock --raw`. Defaults to $BW_SESSION. It is
   * handed to `bw` through the environment, never on the command line,
   * where any local user could read it from the process list. */
  session?: string;
  /** Expected server, e.g. https://vault.example.com. When set, a `bw`
   * logged in to any other server is refused rather than read from, so a
   * reference can't quietly resolve against the wrong vault. */
  serverUrl?: string;
  /** `BITWARDENCLI_APPDATA_DIR` for this alias, so two aliases can be
   * logged in to two servers or accounts at once. Defaults to bw's own. */
  appDataDir?: string;
  /** The `bw` executable. Defaults to $SECREFS_BW_PATH, then `bw` on PATH. */
  bwPath?: string;
  /** Run `bw sync` once before the first read, so a rotated value is
   * picked up instead of bw's local copy. Default true. */
  sync?: boolean;
  /** Per-command timeout. Default 30s. */
  timeoutMs?: number;
  /** Replace the CLI (primarily for testing). */
  run?: BwRunner;
}

interface BwItem {
  id: string;
  name: string;
  type: number;
  folderId?: string | null;
  notes?: string | null;
  login?: {
    username?: string | null;
    password?: string | null;
    totp?: string | null;
    uris?: { uri?: string | null }[] | null;
  } | null;
  fields?: { name?: string | null; value?: string | null }[] | null;
}

/** An error whose `name` the shared classifier already understands, so a
 * locked vault is reported once as an auth problem, not once per item. */
function classified(name: "AuthFailure" | "SecretNotFound", message: string): Error {
  const err = new Error(message);
  err.name = name;
  return err;
}

const AUTH_MESSAGES = /vault is locked|not logged in|session key is invalid|invalid master password|unauthenticated/i;

/**
 * Vaultwarden, and any other Bitwarden **password vault** - including
 * bitwarden.com - through the official Bitwarden CLI.
 *
 * Vaultwarden does not implement Bitwarden Secrets Manager, so
 * `BitwardenProvider` can't reach it. Vault items are end-to-end
 * encrypted like Secrets Manager secrets, and the supported way for a
 * script to decrypt them is `bw`, which is what this drives: log in once
 * with `bw config server <url>` and `bw login`, then export the session
 * from `bw unlock --raw` as BW_SESSION.
 *
 * `path` is an item's id, or its exact name. A name that isn't unique may
 * be qualified by folder: `sec://vaultwarden/prod/stripe` is the item
 * "stripe" in the folder "prod" (folder names may themselves contain
 * slashes, the way Bitwarden nests them). Matching is exact - `bw get
 * item <name>` matches substrings, so it is never used for names.
 *
 * With no `#field`, a login returns its password and a secure note its
 * notes. `#username`, `#password`, `#totp`, `#uri` and `#notes` read
 * those parts of the item; any other field is a custom field of that
 * name, or a key in notes that hold JSON.
 */
export class VaultwardenProvider extends BaseSecretProvider {
  readonly name = "vaultwarden";

  private readonly session?: string;
  private readonly serverUrl?: string;
  private readonly appDataDir?: string;
  private readonly bwPath: string;
  private readonly sync: boolean;
  private readonly timeoutMs: number;
  private readonly run: BwRunner;

  private ready: Promise<void> | null = null;
  /** In-flight item lookups, so a batch naming one item many times (one
   * reference per field is the normal case) runs `bw` for it once.
   * Entries are dropped as they settle: values are never kept. */
  private inFlight = new Map<string, Promise<BwItem>>();
  /** bw is a Node process per command; a batch of fifty references
   * shouldn't start fifty of them. */
  private active = 0;
  private waiting: (() => void)[] = [];
  private static readonly MAX_CONCURRENT = 4;

  constructor(options: VaultwardenProviderOptions = {}) {
    super();
    this.session = options.session ?? process.env.BW_SESSION;
    this.serverUrl = options.serverUrl;
    this.appDataDir = options.appDataDir;
    this.bwPath = options.bwPath ?? process.env.SECREFS_BW_PATH ?? "bw";
    this.sync = options.sync ?? true;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.run = options.run ?? ((args, env) => spawnBw(this.bwPath, args, env, this.timeoutMs));
  }

  private async bw(args: string[]): Promise<unknown> {
    while (this.active >= VaultwardenProvider.MAX_CONCURRENT) {
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    }
    this.active += 1;
    try {
      const env: NodeJS.ProcessEnv = { ...process.env, BW_NOINTERACTION: "true" };
      if (this.session) env.BW_SESSION = this.session;
      if (this.appDataDir) env.BITWARDENCLI_APPDATA_DIR = this.appDataDir;

      let result: Awaited<ReturnType<BwRunner>>;
      try {
        result = await this.run(["--response", "--nointeraction", ...args], env);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
          throw new Error(
            `the Bitwarden CLI ("${this.bwPath}") was not found. Install it with ` +
              `"npm install -g @bitwarden/cli", or set SECREFS_BW_PATH.`,
          );
        }
        throw err;
      }

      // --response makes bw answer in JSON on stdout, success or not.
      let parsed: { success?: boolean; message?: string; data?: unknown };
      try {
        parsed = JSON.parse(result.stdout);
      } catch {
        // Never echo stdout: on a misparse it may be anything.
        throw new Error(`bw ${args[0]} failed (exit ${result.code}): ${result.stderr.trim().slice(0, 200) || "no output"}`);
      }
      if (parsed.success) return parsed.data;

      const message = parsed.message?.trim() || `bw ${args[0]} failed`;
      if (AUTH_MESSAGES.test(message)) throw classified("AuthFailure", message);
      if (/^not found/i.test(message)) throw classified("SecretNotFound", message);
      throw new Error(message);
    } finally {
      this.active -= 1;
      this.waiting.shift()?.();
    }
  }

  /** Once per provider: a session is present, bw is unlocked against the
   * expected server, and (by default) its local copy is fresh. */
  private ensureReady(): Promise<void> {
    if (!this.ready) {
      this.ready = (async () => {
        if (!this.session) {
          throw classified(
            "AuthFailure",
            "BW_SESSION is not set (required for sec://vaultwarden/... references)",
          );
        }
        const status = await this.status();
        if (status.status !== "unlocked") {
          throw classified("AuthFailure", `bw is ${status.status ?? "not ready"}, not unlocked`);
        }
        if (this.serverUrl && normalizeUrl(status.serverUrl) !== normalizeUrl(this.serverUrl)) {
          throw classified(
            "AuthFailure",
            `bw is logged in to ${status.serverUrl ?? "the default server"}, not ${this.serverUrl}`,
          );
        }
        if (this.sync) await this.bw(["sync"]);
      })().catch((err: unknown) => {
        this.ready = null; // let the next call try again
        throw err;
      });
    }
    return this.ready;
  }

  private async status(): Promise<{ status?: string; serverUrl?: string | null }> {
    const data = (await this.bw(["status"])) as { template?: unknown } | undefined;
    // `status` answers with { object: "template", template: {...} }.
    return ((data?.template ?? data) ?? {}) as { status?: string; serverUrl?: string | null };
  }

  private item(path: string): Promise<BwItem> {
    let pending = this.inFlight.get(path);
    if (!pending) {
      pending = this.lookup(path).finally(() => this.inFlight.delete(path));
      this.inFlight.set(path, pending);
    }
    return pending;
  }

  private async lookup(path: string): Promise<BwItem> {
    if (UUID_PATTERN.test(path)) {
      return (await this.bw(["get", "item", path])) as BwItem;
    }

    const exact = await this.itemsNamed(path);
    if (exact.length === 1) return exact[0] as BwItem;
    if (exact.length > 1) throw ambiguous(path, exact.length);

    const slash = path.lastIndexOf("/");
    if (slash > 0) {
      const folderName = path.slice(0, slash);
      const itemName = path.slice(slash + 1);
      const folders = asList(await this.bw(["list", "folders", "--search", folderName])) as {
        id: string;
        name: string;
      }[];
      const folderIds = new Set(folders.filter((f) => f.name === folderName).map((f) => f.id));
      if (folderIds.size > 0) {
        const inFolder = (await this.itemsNamed(itemName)).filter(
          (i) => i.folderId && folderIds.has(i.folderId),
        );
        if (inFolder.length === 1) return inFolder[0] as BwItem;
        if (inFolder.length > 1) throw ambiguous(path, inFolder.length);
      }
    }

    throw classified("SecretNotFound", `no item named "${path}"`);
  }

  private async itemsNamed(name: string): Promise<BwItem[]> {
    const items = asList(await this.bw(["list", "items", "--search", name])) as BwItem[];
    return items.filter((i) => i.name === name);
  }

  async fetchOne(request: SecretFetchRequest): Promise<string> {
    let item: BwItem;
    try {
      await this.ensureReady();
      item = await this.item(request.path);
    } catch (err) {
      throw new SecretFetchError(this.name, request.path, err);
    }
    return valueOf(item, request.field, request.path);
  }

  async healthCheck(): Promise<ProviderHealth> {
    try {
      await this.ensureReady();
      const { serverUrl } = await this.status();
      return { provider: this.name, ok: true, message: `unlocked, ${serverUrl ?? "default server"}` };
    } catch (err) {
      return { provider: this.name, ok: false, message: errorMessage(err) };
    }
  }
}

function asList(data: unknown): unknown[] {
  if (Array.isArray(data)) return data;
  const inner = (data as { data?: unknown } | undefined)?.data;
  return Array.isArray(inner) ? inner : [];
}

function ambiguous(path: string, count: number): Error {
  return new Error(
    `${count} items are named "${path}". Qualify it with its folder (sec://<alias>/<folder>/<name>) ` +
      `or use the item id.`,
  );
}

function normalizeUrl(url: string | null | undefined): string {
  return (url ?? "").trim().replace(/\/+$/, "").toLowerCase();
}

const BUILT_IN_FIELDS = ["password", "username", "totp", "uri", "notes"] as const;

/** Picks the requested part of an item. Errors name the item and the
 * fields that exist, never a value. */
export function valueOf(item: BwItem, field: string | undefined, path: string): string {
  const where = `item "${path}"`;
  const builtIn: Record<(typeof BUILT_IN_FIELDS)[number], string | null | undefined> = {
    password: item.login?.password,
    username: item.login?.username,
    totp: item.login?.totp,
    uri: item.login?.uris?.[0]?.uri,
    notes: item.notes,
  };

  if (!field) {
    if (item.type === LOGIN && builtIn.password) return builtIn.password;
    if (item.type === SECURE_NOTE && builtIn.notes) return builtIn.notes;
    throw new Error(`[vaultwarden] ${where} has no password or notes to return; name a field with #`);
  }

  const custom = (name: string) => item.fields?.find((f) => f.name === name)?.value;

  if (field.startsWith("fields.")) {
    const value = custom(field.slice("fields.".length));
    if (value != null) return value;
  } else {
    const fromBuiltIn = (builtIn as Record<string, string | null | undefined>)[field];
    if (fromBuiltIn != null && fromBuiltIn !== "") return fromBuiltIn;
    const fromCustom = custom(field);
    if (fromCustom != null) return fromCustom;
    if (item.notes) {
      try {
        JSON.parse(item.notes);
        return extractField(item.notes, field, { provider: "vaultwarden", path });
      } catch {
        // not JSON, or no such key - fall through to the error below
      }
    }
  }

  const available = [
    ...BUILT_IN_FIELDS.filter((f) => builtIn[f] != null && builtIn[f] !== ""),
    ...(item.fields ?? []).map((f) => f.name).filter((n): n is string => !!n),
  ];
  throw new Error(
    `[vaultwarden] field "${field}" not found in ${where}` +
      (available.length ? ` (it has: ${available.join(", ")})` : ""),
  );
}

function spawnBw(
  bwPath: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
): ReturnType<BwRunner> {
  return new Promise((resolve, reject) => {
    const child = spawn(bwPath, args, { env, stdio: ["ignore", "pipe", "pipe"], timeout: timeoutMs });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (signal === "SIGTERM") {
        const err = new Error(`bw ${args.find((a) => !a.startsWith("--")) ?? ""} timed out after ${timeoutMs}ms`);
        err.name = "TimeoutError";
        reject(err);
        return;
      }
      resolve({ stdout, stderr, code });
    });
  });
}
