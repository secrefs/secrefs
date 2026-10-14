/**
 * Literal-secret detection shared by the PreToolUse guard and the migrate
 * script.
 *
 * Every function here reports *where* and *what kind*, never the value:
 * anything this module returns may end up in Claude's context, and a
 * detector that echoed what it found would leak the secret it exists to
 * stop.
 */

/** Token formats that are a secret wherever they appear, in any file. */
export const TOKEN_PATTERNS = [
  ["private key", /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----/],
  ["AWS access key ID", /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/],
  ["GitHub token", /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{60,})/],
  ["Anthropic API key", /\bsk-ant-[A-Za-z0-9_-]{20,}/],
  ["OpenAI API key", /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{32,}/],
  ["Stripe secret key", /\b(?:sk|rk)_live_[A-Za-z0-9]{20,}/],
  ["Slack token", /\bxox[abposr]-[A-Za-z0-9-]{10,}/],
  ["Slack webhook URL", /https:\/\/hooks\.slack\.com\/services\/T[A-Z0-9]+\/B[A-Z0-9]+\/[A-Za-z0-9]{12,}/],
  ["Google API key", /\bAIza[0-9A-Za-z_-]{35}\b/],
  ["HashiCorp Vault token", /\bhv[sb]\.[A-Za-z0-9_-]{24,}/],
  ["Bitwarden access token", /\b0\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[A-Za-z0-9]{20,}:[A-Za-z0-9+/=]{16,}/],
  ["npm token", /\bnpm_[A-Za-z0-9]{36}\b/],
  ["1Password service account token", /\bops_[A-Za-z0-9+/=_-]{50,}/],
];

/** A URL with an inline password: postgres://user:pass@host. */
const CREDENTIAL_URL = /\b[a-z][a-z0-9+.-]*:\/\/([^\s:/@'"]+):([^\s@/'"]+)@[^\s/'"]+/gi;

/** Variable names that say the value is a credential. */
const SENSITIVE_KEY = /(PASSWORD|PASSWD|PASSPHRASE|SECRET|TOKEN|API_?KEY|PRIVATE_?KEY|ACCESS_?KEY|CREDENTIAL|_DSN$|^DSN$|WEBHOOK|(^|_)SESSION(_?KEY)?$)/i;

/**
 * Names that match SENSITIVE_KEY but hold something that is not itself a
 * secret: the *name* of an env var (SecRefs' own `tokenEnv` convention),
 * an identifier, a path, a URL to a public endpoint.
 */
const NON_SECRET_SUFFIX = /(_ENV|_ID|_IDS|_FILE|_PATH|_DIR|_NAME|_URL|_URI|_HOST|_REGION|_TTL|_TTL_MS|_EXPIRY|_EXPIRES|_LENGTH|_HEADER|_TYPE|_ENABLED|_MODE)$/i;

const PLACEHOLDER = new RegExp(
  "^(?:" +
    [
      "",
      "\\*+",
      "x{3,}",
      "\\.{3}",
      "<[^>]*>",
      "\\[[^\\]]*\\]",
      "changeme",
      "change[-_]?me[-_a-z0-9]*",
      "replace[-_]?me[-_a-z0-9]*",
      "your[-_].*",
      "my[-_].*",
      "todo",
      "tbd",
      "placeholder",
      "example[-_a-z0-9]*",
      "dummy[-_a-z0-9]*",
      "fake[-_a-z0-9]*",
      "test",
      "secret",
      "password",
      "none",
      "null",
      "undefined",
      "true",
      "false",
      "redacted",
    ].join("|") +
    ")$",
  "i",
);

/** True when a value is a reference or obviously not a real credential. */
export function isHarmlessValue(value) {
  const v = value.trim();
  if (v.startsWith("sec://")) return true;
  // Interpolation of some other mechanism: ${VAR}, $(cmd), {{ tmpl }}, %VAR%.
  if (/\$\{[^}]*\}|\$\([^)]*\)|\{\{[^}]*\}\}|^%[A-Z0-9_]+%$|^\$[A-Z_][A-Z0-9_]*$/i.test(v)) return true;
  if (PLACEHOLDER.test(v)) return true;
  return false;
}

/** A line is exempt when it carries an explicit `secrefs:allow` marker. */
export function isAllowedLine(line) {
  return /secrefs:allow/.test(line);
}

/** `.env`, `.env.production`, `prod.env`, `.envrc` and friends. */
export function isEnvLikeFile(filePath) {
  const base = String(filePath).split(/[\\/]/).pop() ?? "";
  return /^\.env(\..+)?$/.test(base) || /\.env$/.test(base) || base === ".envrc";
}

const ASSIGNMENT = /^[ \t]*(?:export[ \t]+)?([A-Za-z_][A-Za-z0-9_.-]*)[ \t]*[=:][ \t]*(.*)$/;

/**
 * Splits an assignment's right-hand side into its value, honouring quotes
 * and an unquoted trailing ` # comment`. Returns `null` for a quoted value
 * that does not close on this line (a multi-line value).
 */
export function unquoteValue(rhs) {
  const s = rhs.trim();
  const q = s[0];
  if (q === '"' || q === "'" || q === "`") {
    const end = s.indexOf(q, 1);
    if (end === -1) return null;
    return { value: s.slice(1, end), quote: q };
  }
  // dotenv treats ` #` as a comment start; `sec://a/b#field` has no space.
  const hash = s.search(/[ \t]#/);
  return { value: (hash === -1 ? s : s.slice(0, hash)).trim(), quote: "" };
}

/** Parses `KEY=value` from one line, or returns null. */
export function parseAssignment(line) {
  const m = ASSIGNMENT.exec(line);
  if (!m) return null;
  const [, key, rhs] = m;
  const parsed = unquoteValue(rhs);
  return { key, rhs, ...(parsed ?? { value: null, quote: null }) };
}

/** True when the variable name says it holds a credential. */
export function isSensitiveKey(key) {
  const k = key.replace(/[.-]/g, "_");
  return SENSITIVE_KEY.test(k) && !NON_SECRET_SUFFIX.test(k);
}

/**
 * Scans text that is about to be written to `filePath`.
 *
 * Returns findings of `{ line, kind, key? }` with 1-based line numbers
 * relative to `text`. Never includes the matched value.
 */
export function findLiteralSecrets(text, filePath = "") {
  const findings = [];
  const envLike = isEnvLikeFile(filePath);
  const lines = String(text).split(/\r?\n/);

  lines.forEach((line, i) => {
    if (isAllowedLine(line)) return;
    const lineNo = i + 1;
    const assignment = parseAssignment(line);
    const key = assignment?.key;

    for (const [kind, pattern] of TOKEN_PATTERNS) {
      if (pattern.test(line)) {
        findings.push({ line: lineNo, kind, ...(key ? { key } : {}) });
        return;
      }
    }

    for (const m of line.matchAll(CREDENTIAL_URL)) {
      if (!isHarmlessValue(m[2])) {
        findings.push({ line: lineNo, kind: "URL with an inline password", ...(key ? { key } : {}) });
        return;
      }
    }

    // Name-based detection only where names are conventions we know: in
    // source code `const token = "..."` is too often a fixture or a label.
    if (envLike && assignment && isSensitiveKey(assignment.key)) {
      if (assignment.value === null) {
        findings.push({ line: lineNo, kind: "multi-line value for a credential variable", key });
      } else if (!isHarmlessValue(assignment.value)) {
        findings.push({ line: lineNo, kind: "credential variable with a literal value", key });
      }
    }
  });

  return findings;
}
