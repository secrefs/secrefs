import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { callTool } from "../scripts/mcp.mjs";

const MCP = fileURLToPath(new URL("../scripts/mcp.mjs", import.meta.url));
const NODE_PKG = fileURLToPath(new URL("../../node", import.meta.url));
const LIB_BUILT = existsSync(path.join(NODE_PKG, "dist/index.js"));
const VALUE = "local" + "-value-never-returned";

function project({ withLibrary = false } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "secrefs-mcp-"));
  writeFileSync(path.join(dir, ".secrefs.local.json"), JSON.stringify({ db: { password: VALUE } }));
  if (withLibrary) {
    mkdirSync(path.join(dir, "node_modules/@secrefs"), { recursive: true });
    symlinkSync(NODE_PKG, path.join(dir, "node_modules/@secrefs/node"), "dir");
  }
  return dir;
}

test("parse_ref splits a reference and reports malformed ones", async () => {
  assert.deepEqual(await callTool("parse_ref", { ref: "sec://AWS-Prod/prod/db#password" }), {
    provider: "aws-prod",
    path: "prod/db",
    field: "password",
  });
  assert.match((await callTool("parse_ref", { ref: "aws/prod/db" })).error, /sec:\/\//);
});

test("list_aliases falls back to the built-ins, and reads secrefs.config.json", async () => {
  const dir = project();
  assert.deepEqual(Object.keys((await callTool("list_aliases", { project_dir: dir })).aliases), ["aws", "vault", "local", "bitwarden", "vaultwarden", "1password"]);
  writeFileSync(path.join(dir, "secrefs.config.json"), JSON.stringify({ providers: { dev: { type: "local" } } }));
  const listed = await callTool("list_aliases", { project_dir: dir });
  assert.deepEqual(listed.aliases, { dev: { type: "local" } });
});

test("check_refs without the library still reports syntax errors and says how to install", async () => {
  const dir = project();
  const r = await callTool("check_refs", { project_dir: dir, refs: ["nope", "sec://local/db#password"] });
  assert.deepEqual(r.results, [{ ref: "nope", ok: false, message: 'must start with "sec://"' }]);
  assert.match(r.error, /not installed/);
});

test("check_refs resolves through the project's library and never returns the value", { skip: !LIB_BUILT && "packages/node is not built" }, async () => {
  const dir = project({ withLibrary: true });
  const r = await callTool("check_refs", {
    project_dir: dir,
    refs: ["sec://local/db#password", "sec://local/missing", "sec://nowhere/x"],
  });
  assert.deepEqual(r.results.map((x) => x.ok), [true, false, false]);
  assert.match(r.results[2].message, /unknown provider/);
  assert.ok(!JSON.stringify(r).includes(VALUE));
});

test("check_env_file reports references and literal secrets by name only", { skip: !LIB_BUILT && "packages/node is not built" }, async () => {
  const dir = project({ withLibrary: true });
  const plaintext = "plain" + "text-password-1";
  writeFileSync(path.join(dir, ".env"), `DB_PASSWORD=sec://local/db#password\nAPI_TOKEN=${plaintext}\nPORT=1\n`);
  const r = await callTool("check_env_file", { project_dir: dir });
  assert.deepEqual(r.results, [{ key: "DB_PASSWORD", ref: "sec://local/db#password", ok: true }]);
  assert.deepEqual(r.literalSecrets, [{ line: 2, key: "API_TOKEN" }]);
  assert.ok(!JSON.stringify(r).includes(VALUE) && !JSON.stringify(r).includes(plaintext));
});

test("speaks MCP over stdio", async () => {
  const child = spawn(process.execPath, [MCP], { stdio: ["pipe", "pipe", "inherit"] });
  const replies = [];
  let buffer = "";
  const done = new Promise((resolve) => {
    child.stdout.on("data", (chunk) => {
      buffer += chunk;
      let nl;
      while ((nl = buffer.indexOf("\n")) !== -1) {
        replies.push(JSON.parse(buffer.slice(0, nl)));
        buffer = buffer.slice(nl + 1);
        if (replies.length === 3) resolve();
      }
    });
  });
  const send = (m) => child.stdin.write(JSON.stringify({ jsonrpc: "2.0", ...m }) + "\n");
  send({ id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } } });
  send({ method: "notifications/initialized" });
  send({ id: 2, method: "tools/list" });
  send({ id: 3, method: "tools/call", params: { name: "parse_ref", arguments: { ref: "sec://local/db#password" } } });
  await done;
  child.kill();

  assert.equal(replies[0].result.serverInfo.name, "secrefs");
  assert.deepEqual(replies[1].result.tools.map((t) => t.name), ["parse_ref", "list_aliases", "check_refs", "check_env_file"]);
  assert.deepEqual(JSON.parse(replies[2].result.content[0].text), { provider: "local", path: "db", field: "password" });
});
