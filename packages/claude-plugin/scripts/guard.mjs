#!/usr/bin/env node
/**
 * PreToolUse guard: refuses a Write, Edit, MultiEdit or NotebookEdit that
 * would put a literal secret into a file, and tells Claude to write a
 * `sec://` reference instead.
 *
 * The refusal names the file, line, variable and kind of secret. It never
 * repeats the value.
 *
 * Opt out per line with a `secrefs:allow` comment, or for a whole session
 * with SECREFS_GUARD=off. A guard that cannot read its input lets the call
 * through and says so on stderr: a broken hook must not wedge every edit.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { findLiteralSecrets } from "./lib/detect.mjs";

/** The text a tool call would write, per tool. */
export function textsToScan(toolName, input) {
  switch (toolName) {
    case "Write":
      return [input.content ?? ""];
    case "Edit":
      return [input.new_string ?? ""];
    case "MultiEdit":
      return (input.edits ?? []).map((e) => e.new_string ?? "");
    case "NotebookEdit":
      return [input.new_source ?? ""];
    default:
      return [];
  }
}

export function evaluate(event) {
  const input = event.tool_input ?? {};
  const filePath = input.file_path ?? input.notebook_path ?? "";
  const findings = textsToScan(event.tool_name, input).flatMap((t) =>
    findLiteralSecrets(t, filePath),
  );
  if (findings.length === 0) return null;

  const rel = event.cwd && filePath ? path.relative(event.cwd, filePath) || filePath : filePath;
  const list = findings
    .slice(0, 10)
    .map((f) => `  - ${f.key ? `${f.key}: ` : ""}${f.kind} (line ${f.line} of the new text)`)
    .join("\n");
  const more = findings.length > 10 ? `\n  - and ${findings.length - 10} more` : "";
  const example = findings.find((f) => f.key)?.key ?? "DB_PASSWORD";

  return [
    `SecRefs blocked writing a literal secret to ${rel || "this file"}:`,
    list + more,
    "",
    "Do not write the value. Write a reference to where it is stored instead, for example:",
    `  ${example}=sec://<alias>/<path>#<field>`,
    "If the value is not in a vault yet, ask the user to store it there themselves (never paste it into the conversation), then write the reference.",
    "Use the secrefs MCP tools (list_aliases, check_refs) to find the right alias and confirm the reference resolves.",
    "If this is a false positive such as a test fixture or documentation, add a `secrefs:allow` comment on that line.",
  ].join("\n");
}

function main() {
  if (process.env.SECREFS_GUARD === "off") return;

  let event;
  try {
    event = JSON.parse(readFileSync(0, "utf8"));
  } catch (err) {
    process.stderr.write(`secrefs guard: could not read hook input, allowing: ${err.message}\n`);
    return;
  }

  const reason = evaluate(event);
  if (!reason) return;

  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: reason,
      },
    }),
  );
}

if (process.argv[1]?.endsWith("guard.mjs")) main();
