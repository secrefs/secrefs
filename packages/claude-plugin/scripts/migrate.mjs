#!/usr/bin/env node
/**
 * Moves plaintext secrets in a .env file to `sec://` references, without
 * the values ever passing through Claude.
 *
 *   migrate.mjs plan  <env-file> [--alias <alias>] [--prefix <path-prefix>]
 *   migrate.mjs apply <env-file> --map '<json {KEY: "sec://..."}>'
 *
 * `plan` prints JSON describing each variable (name, kind, suggested
 * reference) and no values. `apply` rewrites the mapped lines to their
 * references. For references to a `local` alias it also moves the value
 * into that alias's gitignored JSON file, so the reference resolves at
 * once. For any other alias the original lines go to a backup file
 * readable only by the owner; the user stores each value in their vault
 * and deletes the backup. Output is JSON and never contains a value.
 */
import { chmodSync, existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { findLiteralSecrets, isHarmlessValue, isSensitiveKey, parseAssignment } from "./lib/detect.mjs";
import { listAliases, localFileFor, parseRef } from "./lib/project.mjs";

function fail(message) {
  process.stdout.write(JSON.stringify({ error: message }, null, 2) + "\n");
  process.exit(1);
}

function parseArgs(argv) {
  const [command, file, ...rest] = argv;
  const flags = {};
  for (let i = 0; i < rest.length; i += 1) {
    const flag = rest[i];
    if (!flag.startsWith("--")) fail(`unexpected argument "${flag}"`);
    flags[flag.slice(2)] = rest[i + 1];
    i += 1;
  }
  return { command, file, flags };
}

function slug(key) {
  return key.toLowerCase().replace(/[_.]+/g, "-");
}

function classify(line, filePath) {
  const a = parseAssignment(line);
  if (!a) return null;
  if (a.value === null) return { key: a.key, kind: "multi-line", migratable: false };
  if (a.value.startsWith("sec://")) {
    const parsed = parseRef(a.value);
    return { key: a.key, kind: parsed.error ? "invalid-reference" : "reference", ref: a.value, migratable: false };
  }
  if (a.value === "") return { key: a.key, kind: "empty", migratable: false };
  const detected = findLiteralSecrets(line, filePath)[0];
  if (detected) return { key: a.key, kind: "secret", reason: detected.kind, migratable: true };
  if (isSensitiveKey(a.key) && !isHarmlessValue(a.value)) {
    return { key: a.key, kind: "secret", reason: "credential variable name", migratable: true };
  }
  return { key: a.key, kind: "config", migratable: false };
}

export function plan(text, filePath, { alias, prefix, dir }) {
  const { source, aliases } = listAliases(dir);
  const names = Object.keys(aliases);
  const chosen = alias ?? (names.length === 1 ? names[0] : names.includes("local") ? "local" : names[0]);
  // A 1Password reference needs a vault and an item. Without a prefix to
  // name the vault, the suggestion carries a placeholder to replace.
  const isOnePassword = aliases[chosen]?.type === "1password";
  const base = prefix ? prefix.replace(/^\/+|\/+$/g, "") + "/" : isOnePassword ? "VAULT/" : "";

  const entries = [];
  text.split(/\r?\n/).forEach((line, i) => {
    const c = classify(line, filePath);
    if (!c) return;
    const entry = { line: i + 1, ...c };
    if (c.migratable) entry.suggested = `sec://${chosen}/${base}${slug(c.key)}`;
    entries.push(entry);
  });

  return {
    file: filePath,
    config: source,
    aliases: Object.fromEntries(Object.entries(aliases).map(([n, v]) => [n, v.type])),
    suggestedAlias: chosen,
    entries,
    note:
      "Values are not shown. Review the suggested references (alias, path, optional #field), " +
      "then run apply with a map of KEY to reference for the variables to migrate." +
      (isOnePassword
        ? " 1Password references are <vault>/<item>[/<section>]#<field>; replace VAULT with the vault name, " +
          "and consider grouping related values into one item's fields."
        : ""),
  };
}

function setField(target, dotted, value) {
  const parts = dotted.split(".");
  let node = target;
  for (const part of parts.slice(0, -1)) {
    if (typeof node[part] !== "object" || node[part] === null) node[part] = {};
    node = node[part];
  }
  node[parts.at(-1)] = value;
}

function isGitIgnored(file) {
  const r = spawnSync("git", ["check-ignore", "-q", file], { cwd: path.dirname(file) });
  if (r.error || r.status === 128) return undefined; // not a git repo, or git missing
  return r.status === 0;
}

export function apply(text, filePath, map, { dir }) {
  for (const [key, ref] of Object.entries(map)) {
    const parsed = parseRef(ref);
    if (parsed.error) fail(`${key}: ${parsed.error}`);
  }

  const lines = text.split(/(\r?\n)/);
  const migrated = [];
  const backupLines = [];
  const localWrites = new Map(); // file -> data
  const seen = new Set();

  for (let i = 0; i < lines.length; i += 2) {
    const a = parseAssignment(lines[i]);
    if (!a || !(a.key in map) || seen.has(a.key)) continue;
    if (a.value === null) fail(`${a.key}: multi-line values must be moved by hand`);
    seen.add(a.key);

    const ref = map[a.key];
    const parsed = parseRef(ref);
    const prefix = /^[ \t]*export[ \t]+/.test(lines[i]) ? "export " : "";
    const localFile = localFileFor(parsed.provider, dir);

    if (localFile) {
      if (!localWrites.has(localFile)) {
        localWrites.set(localFile, existsSync(localFile) ? JSON.parse(readFileSync(localFile, "utf8")) : {});
      }
      const data = localWrites.get(localFile);
      if (parsed.field) {
        if (typeof data[parsed.path] !== "object" || data[parsed.path] === null) data[parsed.path] = {};
        setField(data[parsed.path], parsed.field, a.value);
      } else {
        data[parsed.path] = a.value;
      }
    } else {
      backupLines.push(lines[i]);
    }

    lines[i] = `${prefix}${a.key}=${ref}`;
    migrated.push({ key: a.key, ref, storedIn: localFile ? path.relative(dir, localFile) : "your vault (not yet)" });
  }

  const missing = Object.keys(map).filter((k) => !seen.has(k));
  if (missing.length) fail(`not found in ${filePath}: ${missing.join(", ")}`);

  const warnings = [];
  for (const [file, data] of localWrites) {
    writeFileSync(file, JSON.stringify(data, null, 2) + "\n", { mode: 0o600 });
    chmodSync(file, 0o600);
    if (isGitIgnored(file) === false) warnings.push(`${path.relative(dir, file)} is not gitignored. Add it to .gitignore before committing.`);
  }

  let backup;
  if (backupLines.length) {
    backup = `${filePath}.pre-secrefs`;
    writeFileSync(backup, backupLines.join("\n") + "\n", { mode: 0o600 });
    chmodSync(backup, 0o600);
    if (isGitIgnored(backup) === false) warnings.push(`${path.relative(dir, backup)} is not gitignored. Do not commit it.`);
  }

  writeFileSync(filePath, lines.join(""));

  const toStore = migrated
    .filter((m) => !localFileFor(parseRef(m.ref).provider, dir))
    .map((m) => {
      const p = parseRef(m.ref);
      return { key: m.key, alias: p.provider, path: p.path, ...(p.field ? { field: p.field } : {}) };
    });

  return {
    file: filePath,
    migrated,
    ...(backup ? { backup: path.relative(dir, backup) } : {}),
    ...(toStore.length
      ? {
          nextSteps:
            `Store each value from ${path.relative(dir, backup)} in the vault behind its alias, ` +
            "at the path (and JSON field) shown, then delete the backup. Until then these references will not resolve.",
          toStore,
        }
      : {}),
    warnings,
  };
}

function main() {
  const { command, file, flags } = parseArgs(process.argv.slice(2));
  if (!["plan", "apply"].includes(command) || !file) {
    fail("usage: migrate.mjs plan <env-file> [--alias A] [--prefix P] | apply <env-file> --map '{\"KEY\":\"sec://...\"}'");
  }
  if (!existsSync(file)) fail(`${file} does not exist`);
  // Real paths on both sides, so reported paths stay relative where a
  // symlinked temp or home directory would otherwise make them climb out.
  const filePath = realpathSync(file);
  const dir = realpathSync(flags.dir ?? process.cwd());
  const text = readFileSync(filePath, "utf8");

  let result;
  if (command === "plan") {
    result = plan(text, filePath, { alias: flags.alias, prefix: flags.prefix, dir });
  } else {
    let map;
    try {
      map = JSON.parse(flags.map ?? "");
    } catch {
      fail('--map must be JSON, e.g. --map \'{"DB_PASSWORD":"sec://aws/prod/db#password"}\'');
    }
    result = apply(text, filePath, map, { dir });
  }
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}

if (process.argv[1]?.endsWith("migrate.mjs")) main();
