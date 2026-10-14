import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { evaluate } from "../scripts/guard.mjs";

const GUARD = fileURLToPath(new URL("../scripts/guard.mjs", import.meta.url));
const SECRET = "hunter2" + "hunter2";

function run(event, env = {}) {
  return spawnSync(process.execPath, [GUARD], {
    input: typeof event === "string" ? event : JSON.stringify(event),
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

test("denies a Write of a literal secret and never echoes it", () => {
  const r = run({
    tool_name: "Write",
    cwd: "/repo",
    tool_input: { file_path: "/repo/.env", content: `DB_PASSWORD=${SECRET}\nPORT=3000\n` },
  });
  assert.equal(r.status, 0);
  const out = JSON.parse(r.stdout).hookSpecificOutput;
  assert.equal(out.permissionDecision, "deny");
  assert.match(out.permissionDecisionReason, /\.env/);
  assert.match(out.permissionDecisionReason, /DB_PASSWORD/);
  assert.match(out.permissionDecisionReason, /sec:\/\//);
  assert.ok(!r.stdout.includes(SECRET));
});

test("checks Edit, MultiEdit and NotebookEdit text", () => {
  const file = "/repo/.env";
  assert.ok(evaluate({ tool_name: "Edit", tool_input: { file_path: file, old_string: "x", new_string: `API_KEY=${SECRET}` } }));
  assert.ok(
    evaluate({
      tool_name: "MultiEdit",
      tool_input: { file_path: file, edits: [{ new_string: "A=1" }, { new_string: `TOKEN=${SECRET}` }] },
    }),
  );
  const pem = ["-----BEGIN", "PRIVATE KEY-----"].join(" ");
  assert.ok(evaluate({ tool_name: "NotebookEdit", tool_input: { notebook_path: "n.ipynb", new_source: pem } }));
});

test("only the new text counts: an Edit that removes a secret is allowed", () => {
  assert.equal(
    evaluate({
      tool_name: "Edit",
      tool_input: { file_path: "/repo/.env", old_string: `DB_PASSWORD=${SECRET}`, new_string: "DB_PASSWORD=sec://aws/prod/db#password" },
    }),
    null,
  );
});

test("allows clean writes with no output", () => {
  const r = run({ tool_name: "Write", tool_input: { file_path: "/repo/.env", content: "DB_PASSWORD=sec://local/db#password\n" } });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, "");
});

test("SECREFS_GUARD=off disables the guard", () => {
  const r = run({ tool_name: "Write", tool_input: { file_path: ".env", content: `DB_PASSWORD=${SECRET}` } }, { SECREFS_GUARD: "off" });
  assert.equal(r.stdout, "");
});

test("unreadable input fails open with a note on stderr", () => {
  const r = run("not json");
  assert.equal(r.status, 0);
  assert.equal(r.stdout, "");
  assert.match(r.stderr, /allowing/);
});
