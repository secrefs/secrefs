/**
 * Reading a project's SecRefs setup without the library installed: the
 * reference grammar and `secrefs.config.json` discovery. Both mirror
 * packages/node (src/parser.ts, src/config.ts); test/parity.test.mjs holds
 * the grammar to the built library when it is present.
 */
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const SEC_REF_PATTERN = /^sec:\/\/([a-zA-Z0-9][a-zA-Z0-9_-]*)\/([^\s#]+)(?:#([^\s#]+))?$/;

export const CONFIG_FILENAME = "secrefs.config.json";

/** The aliases the library registers when no config file exists. */
export const BUILT_IN_ALIASES = {
  aws: { type: "aws" },
  vault: { type: "vault" },
  local: { type: "local" },
  bitwarden: { type: "bitwarden" },
  vaultwarden: { type: "vaultwarden" },
  "1password": { type: "1password" },
};

/** Parses a reference, or returns `{ error }`. */
export function parseRef(raw) {
  if (typeof raw !== "string") return { error: "reference must be a string" };
  const trimmed = raw.trim();
  if (!trimmed.startsWith("sec://")) return { error: 'must start with "sec://"' };
  const m = SEC_REF_PATTERN.exec(trimmed);
  if (!m) return { error: "does not match sec://<provider>/<path>[#field] format" };
  return { provider: m[1].toLowerCase(), path: m[2], ...(m[3] ? { field: m[3] } : {}) };
}

/** Walks up from `dir` to the nearest secrefs.config.json. */
export function findConfig(dir) {
  let current = path.resolve(dir);
  for (;;) {
    const candidate = path.join(current, CONFIG_FILENAME);
    if (existsSync(candidate)) {
      const config = JSON.parse(readFileSync(candidate, "utf8"));
      return { path: candidate, config };
    }
    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

/**
 * The aliases a reference can name in this project, with each alias's
 * settings. The config format holds no secrets by design (the library
 * refuses inline credentials), so these are safe to show.
 */
export function listAliases(dir) {
  const found = findConfig(dir);
  if (!found) return { source: "built-in defaults (no secrefs.config.json found)", aliases: BUILT_IN_ALIASES };
  return { source: found.path, aliases: found.config.providers ?? {} };
}

/** Where the `local` provider for `alias` keeps its file. */
export function localFileFor(alias, dir) {
  const found = findConfig(dir);
  const entry = found ? found.config.providers?.[alias] : BUILT_IN_ALIASES[alias];
  if (!entry || entry.type !== "local") return undefined;
  if (found && entry.file) return path.resolve(path.dirname(found.path), entry.file);
  if (process.env.SECREFS_LOCAL_FILE) return path.resolve(dir, process.env.SECREFS_LOCAL_FILE);
  return path.join(found ? path.dirname(found.path) : dir, ".secrefs.local.json");
}

/**
 * Imports the project's own @secrefs/node (or the `secrefs` alias), so
 * resolution checks run with exactly the version and providers the project
 * uses. Never downloads anything.
 */
export async function loadProjectLibrary(dir) {
  const require = createRequire(path.join(path.resolve(dir), "__secrefs_plugin__.js"));
  for (const name of ["@secrefs/node", "secrefs"]) {
    try {
      return await import(pathToFileURL(require.resolve(name)).href);
    } catch {
      // try the next name
    }
  }
  return undefined;
}
