import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MIGRATE = fileURLToPath(new URL("../scripts/migrate.mjs", import.meta.url));
const DB_PASS = "pg" + "-pa55-word-0001";
const API_KEY = "key" + "-0123456789abcdef";

function project(config) {
  const dir = mkdtempSync(path.join(tmpdir(), "secrefs-migrate-"));
  if (config) writeFileSync(path.join(dir, "secrefs.config.json"), JSON.stringify(config));
  writeFileSync(
    path.join(dir, ".env"),
    [
      "# app",
      "PORT=3000",
      `DB_PASSWORD=${DB_PASS}`,
      `export VENDOR_API_KEY="${API_KEY}" # vendor`,
      "SESSION_SECRET=sec://local/session#secret",
      "EMPTY_TOKEN=",
      "",
    ].join("\n"),
  );
  return dir;
}

function run(dir, ...args) {
  const r = spawnSync(process.execPath, [MIGRATE, ...args, "--dir", dir], { cwd: dir, encoding: "utf8" });
  return { ...r, json: JSON.parse(r.stdout) };
}

test("plan classifies variables and never prints a value", () => {
  const dir = project();
  const { json, stdout } = run(dir, "plan", ".env");
  const byKey = Object.fromEntries(json.entries.map((e) => [e.key, e]));
  assert.equal(byKey.PORT.kind, "config");
  assert.equal(byKey.DB_PASSWORD.kind, "secret");
  assert.equal(byKey.DB_PASSWORD.suggested, "sec://local/db-password");
  assert.equal(byKey.VENDOR_API_KEY.kind, "secret");
  assert.equal(byKey.SESSION_SECRET.kind, "reference");
  assert.equal(byKey.EMPTY_TOKEN.kind, "empty");
  assert.ok(!stdout.includes(DB_PASS));
  assert.ok(!stdout.includes(API_KEY));
});

test("plan uses the configured alias", () => {
  const dir = project({ providers: { "aws-prod": { type: "aws", profile: "p" } } });
  const { json } = run(dir, "plan", ".env", "--prefix", "prod/app");
  assert.equal(json.suggestedAlias, "aws-prod");
  assert.equal(json.entries.find((e) => e.key === "DB_PASSWORD").suggested, "sec://aws-prod/prod/app/db-password");
});

test("apply to a local alias moves values into the local file", () => {
  const dir = project();
  const map = { DB_PASSWORD: "sec://local/db#password", VENDOR_API_KEY: "sec://local/vendor" };
  const { json, stdout, status } = run(dir, "apply", ".env", "--map", JSON.stringify(map));
  assert.equal(status, 0, stdout);
  assert.ok(!stdout.includes(DB_PASS));
  assert.equal(json.backup, undefined);

  const env = readFileSync(path.join(dir, ".env"), "utf8");
  assert.match(env, /^DB_PASSWORD=sec:\/\/local\/db#password$/m);
  assert.match(env, /^export VENDOR_API_KEY=sec:\/\/local\/vendor$/m);
  assert.match(env, /^PORT=3000$/m);
  assert.ok(!env.includes(DB_PASS) && !env.includes(API_KEY));

  const localFile = path.join(dir, ".secrefs.local.json");
  assert.deepEqual(JSON.parse(readFileSync(localFile, "utf8")), { db: { password: DB_PASS }, vendor: API_KEY });
  assert.equal(statSync(localFile).mode & 0o777, 0o600);
});

test("apply to a vault alias writes an owner-only backup and lists what to store", () => {
  const dir = project({ providers: { aws: { type: "aws" } } });
  const { json, stdout } = run(dir, "apply", ".env", "--map", JSON.stringify({ DB_PASSWORD: "sec://aws/prod/db#password" }));
  assert.ok(!stdout.includes(DB_PASS));
  assert.equal(json.backup, ".env.pre-secrefs");
  assert.deepEqual(json.toStore, [{ key: "DB_PASSWORD", alias: "aws", path: "prod/db", field: "password" }]);
  const backup = path.join(dir, ".env.pre-secrefs");
  assert.match(readFileSync(backup, "utf8"), /DB_PASSWORD=/);
  assert.equal(statSync(backup).mode & 0o777, 0o600);
});

test("apply rejects malformed references and unknown keys without touching the file", () => {
  const dir = project();
  const before = readFileSync(path.join(dir, ".env"), "utf8");
  assert.equal(run(dir, "apply", ".env", "--map", '{"DB_PASSWORD":"aws/prod/db"}').status, 1);
  assert.equal(run(dir, "apply", ".env", "--map", '{"NOPE":"sec://local/x"}').status, 1);
  assert.equal(readFileSync(path.join(dir, ".env"), "utf8"), before);
});
