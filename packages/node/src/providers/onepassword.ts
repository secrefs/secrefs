import {
  BaseSecretProvider,
  SecretFetchError,
  errorMessage,
  type ProviderHealth,
  type SecretFetchRequest,
} from "./base.js";

/** The one SDK call this provider makes - kept narrow so tests can inject
 * a plain object, the same pattern the other SDK-backed providers use. */
export interface OnePasswordClientLike {
  secrets: {
    resolveAll(references: string[]): Promise<{
      individualResponses: Record<
        string,
        { content?: { secret: string }; error?: { type: string; message?: string } }
      >;
    }>;
  };
}

export interface OnePasswordProviderOptions {
  /** Service account token. Defaults to $OP_SERVICE_ACCOUNT_TOKEN. Takes
   * precedence over `account`. */
  serviceAccountToken?: string;
  /** Account name (as shown at the top of the 1Password app's sidebar) or
   * account UUID, to authenticate through the desktop app instead of a
   * token. Defaults to $OP_ACCOUNT. The app asks the person at the
   * keyboard to approve - Touch ID, Windows Hello or their system
   * password - so this suits a developer's machine, not CI. */
  account?: string;
  /** Inject a pre-configured client (primarily for testing). */
  client?: OnePasswordClientLike;
}

const INTEGRATION_NAME = "SecRefs";
const INTEGRATION_VERSION = "1";
const DEFAULT_FIELD = "password";

/** Errors whose `name` the shared classifier already understands. */
function classified(name: "AuthFailure" | "SecretNotFound" | "ThrottlingException", message: string): Error {
  const err = new Error(message);
  err.name = name;
  return err;
}

const NOT_FOUND = new Set(["vaultNotFound", "itemNotFound", "fieldNotFound", "noMatchingSections"]);
const AMBIGUOUS: Record<string, string> = {
  tooManyVaults: "more than one vault matches",
  tooManyItems: "more than one item matches; use the item id",
  tooManyMatchingFields: "more than one field matches; qualify it with its section",
};

/**
 * Turns `path` and `field` into a 1Password secret reference.
 *
 * `sec://1password/Prod/Stripe#api_key`  -> `op://Prod/Stripe/api_key`
 * `sec://1password/Prod/Stripe/Live#key` -> `op://Prod/Stripe/Live/key` (section "Live")
 * `sec://1password/Prod/Stripe/api_key`  -> `op://Prod/Stripe/api_key`
 * `sec://1password/Prod/Stripe`          -> `op://Prod/Stripe/password`
 *
 * A reference can't contain spaces, so names with one are written
 * percent-encoded (`My%20Vault`) or replaced by their ids. The field is
 * used verbatim: unlike other providers, `#a.b` is not a JSON path.
 */
export function toOpReference(path: string, field: string | undefined): string {
  const segments = path.split("/").map((segment) => {
    let decoded: string;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      throw new Error(`"${segment}" is not valid percent-encoding`);
    }
    if (!decoded || decoded.includes("/")) {
      throw new Error(`"${path}" has an empty segment, or one that decodes to a "/"`);
    }
    return decoded;
  });

  const parts = field ? [...segments, field] : segments.length === 2 ? [...segments, DEFAULT_FIELD] : segments;
  if (parts.length < 3 || parts.length > 4) {
    throw new Error(
      `"${path}${field ? `#${field}` : ""}" must name <vault>/<item>[/<section>] and a field, ` +
        `e.g. sec://1password/Prod/Stripe#api_key`,
    );
  }
  return `op://${parts.join("/")}`;
}

/**
 * 1Password, through its official SDK.
 *
 * Authenticates with a service account token (non-interactive; CI and
 * agents) or, with `account`, through the 1Password desktop app, which
 * asks the person at the keyboard to approve. Nothing is cached to disk
 * either way. A service account sees only the vaults it was granted, and
 * a vault it can't see is reported as not found.
 *
 * References requested together are resolved in one `resolveAll` call:
 * every reference in a `.env` is fetched at once, and service accounts
 * are rate-limited per request.
 */
export class OnePasswordProvider extends BaseSecretProvider {
  readonly name = "1password";

  private readonly token?: string;
  private readonly account?: string;
  private client: Promise<OnePasswordClientLike> | null;
  private queue: { reference: string; resolve: (v: string) => void; reject: (e: unknown) => void }[] = [];
  private flushScheduled = false;

  constructor(options: OnePasswordProviderOptions = {}) {
    super();
    this.token = options.serviceAccountToken ?? process.env.OP_SERVICE_ACCOUNT_TOKEN;
    this.account = options.account ?? process.env.OP_ACCOUNT;
    this.client = options.client ? Promise.resolve(options.client) : null;
  }

  private getClient(): Promise<OnePasswordClientLike> {
    if (!this.client) {
      this.client = this.createClient().catch((err: unknown) => {
        this.client = null; // let the next call try again
        throw err;
      });
    }
    return this.client;
  }

  private async createClient(): Promise<OnePasswordClientLike> {
    if (!this.token && !this.account) {
      throw classified(
        "AuthFailure",
        "neither OP_SERVICE_ACCOUNT_TOKEN nor OP_ACCOUNT is set (required for sec://1password/... references)",
      );
    }
    // Imported at first use: the SDK carries a WebAssembly core that
    // nobody without a sec://1password/... reference should pay to load.
    const sdk = await import("@1password/sdk");
    try {
      return (await sdk.createClient({
        auth: this.token || new sdk.DesktopAuth(this.account as string),
        integrationName: INTEGRATION_NAME,
        integrationVersion: INTEGRATION_VERSION,
      })) as unknown as OnePasswordClientLike;
    } catch (err) {
      throw classifySdkError(err, this.token ? "service account token" : `desktop app, account "${this.account}"`);
    }
  }

  async fetchOne(request: SecretFetchRequest): Promise<string> {
    let reference: string;
    try {
      reference = toOpReference(request.path, request.field);
    } catch (err) {
      throw new SecretFetchError(this.name, request.path, err);
    }
    try {
      return await new Promise<string>((resolve, reject) => {
        this.queue.push({ reference, resolve, reject });
        if (!this.flushScheduled) {
          this.flushScheduled = true;
          // Every fetchOne started in this turn of the event loop - the
          // resolver starts them all at once - joins one resolveAll.
          setImmediate(() => void this.flush());
        }
      });
    } catch (err) {
      throw new SecretFetchError(this.name, request.path, err);
    }
  }

  private async flush(): Promise<void> {
    const batch = this.queue;
    this.queue = [];
    this.flushScheduled = false;

    let responses: Awaited<ReturnType<OnePasswordClientLike["secrets"]["resolveAll"]>>["individualResponses"];
    try {
      const client = await this.getClient();
      const unique = [...new Set(batch.map((b) => b.reference))];
      responses = (await client.secrets.resolveAll(unique)).individualResponses;
    } catch (err) {
      const failure = err instanceof Error && err.name !== "Error" ? err : classifySdkError(err, "request", false);
      for (const b of batch) b.reject(failure);
      return;
    }

    for (const b of batch) {
      const response = responses[b.reference];
      if (response?.content) {
        b.resolve(response.content.secret);
      } else {
        b.reject(referenceError(b.reference, response?.error));
      }
    }
  }

  async healthCheck(): Promise<ProviderHealth> {
    try {
      await this.getClient();
      return {
        provider: this.name,
        ok: true,
        message: this.token ? "service account" : `desktop app, account "${this.account}"`,
      };
    } catch (err) {
      return { provider: this.name, ok: false, message: errorMessage(err) };
    }
  }
}

/** Names never include a value: the SDK's per-reference errors carry
 * only a type, and its messages describe the request, not the secret. */
function referenceError(reference: string, error: { type: string; message?: string } | undefined): Error {
  const type = error?.type ?? "other";
  const label = reference.replace(/^op:\/\//, "");
  if (NOT_FOUND.has(type)) {
    const what = type.replace("NotFound", "").replace("noMatchingSections", "section");
    return classified("SecretNotFound", `${what} not found for "${label}" (or the account can't see that vault)`);
  }
  if (AMBIGUOUS[type]) return new Error(`"${label}": ${AMBIGUOUS[type]}`);
  return new Error(`"${label}": ${type}${error?.message ? ` - ${error.message}` : ""}`);
}

/** The SDK's own error classes don't set `name`, so they are matched by
 * constructor name and recast into ones the shared classifier reads. */
function classifySdkError(err: unknown, how: string, unknownIsAuth = true): Error {
  const kind = (err as { constructor?: { name?: string } })?.constructor?.name ?? "";
  const message = errorMessage(err);
  if (kind === "AuthExpiredError" || kind === "DesktopSessionExpiredError") {
    return classified("AuthFailure", `1Password session expired (${how}): ${message}`);
  }
  if (kind === "RateLimitExceededError") {
    return classified("ThrottlingException", `1Password rate limit exceeded: ${message}`);
  }
  if (!unknownIsAuth || /timed? ?out|network|connect|getaddrinfo|econn/i.test(message)) {
    return err instanceof Error ? err : new Error(message);
  }
  // Failing to create a client is, short of the network, a credential
  // problem: a malformed or revoked token, or a desktop app that is
  // locked, not running, or not set up to integrate with other apps.
  return classified("AuthFailure", `could not authenticate with 1Password (${how}): ${message}`);
}
