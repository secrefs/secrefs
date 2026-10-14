#!/usr/bin/env node
/**
 * A minimal MCP server (stdio, newline-delimited JSON-RPC) that lets Claude
 * work with references without ever seeing a secret value.
 *
 * Tools:
 *   parse_ref       - is this string a well-formed reference, and what does it name?
 *   list_aliases    - which aliases can a reference use in this project?
 *   check_refs      - do these references resolve? (ok / error per reference)
 *   check_env_file  - the same for every reference in an env file, plus the
 *                     names of variables that still hold literal secrets
 *
 * Resolution uses the project's own @secrefs/node, through the library's
 * `check()`, which reports success or a classified error and never returns
 * a value. Nothing here returns a resolved value: there is deliberately no
 * tool that could.
 *
 * Zero dependencies, so the plugin works without an install step.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import { findLiteralSecrets, parseAssignment } from "./lib/detect.mjs";
import { listAliases, loadProjectLibrary, parseRef } from "./lib/project.mjs";

const SERVER = { name: "secrefs", version: "0.1.0" };
const DEFAULT_PROTOCOL = "2025-06-18";

const projectDirProp = {
  project_dir: {
    type: "string",
    description: "Project root. Defaults to the directory Claude Code was started in.",
  },
};

export const TOOLS = [
  {
    name: "parse_ref",
    description:
      "Check that a string is a well-formed sec:// reference and split it into provider alias, path and JSON field. Does not contact any vault.",
    inputSchema: {
      type: "object",
      properties: { ref: { type: "string", description: "e.g. sec://aws-prod/db#password" } },
      required: ["ref"],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "list_aliases",
    description:
      "List the provider aliases a reference can name in this project (from secrefs.config.json, or the built-in aws/vault/local/bitwarden), with each alias's type and non-secret settings.",
    inputSchema: { type: "object", properties: { ...projectDirProp } },
    annotations: { readOnlyHint: true },
  },
  {
    name: "check_refs",
    description:
      "Check whether sec:// references resolve, using the project's own @secrefs/node and the user's ambient vault credentials. Returns ok or a classified error per reference. Never returns secret values.",
    inputSchema: {
      type: "object",
      properties: {
        refs: { type: "array", items: { type: "string" }, minItems: 1 },
        ...projectDirProp,
      },
      required: ["refs"],
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  {
    name: "check_env_file",
    description:
      "Check every sec:// reference in an env file resolves, and list (by name only) variables that still hold literal secrets. Never returns any value from the file.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Env file, relative to project_dir. Defaults to .env" },
        ...projectDirProp,
      },
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
];

function projectDir(args) {
  return path.resolve(args.project_dir ?? process.env.CLAUDE_PROJECT_DIR ?? process.cwd());
}

async function checkWithLibrary(entries, dir) {
  const lib = await loadProjectLibrary(dir);
  if (!lib) {
    return {
      error:
        `@secrefs/node is not installed in ${dir}, so references cannot be resolved from here. ` +
        "Install it (npm i -D @secrefs/node) or run `npx secrefs check` yourself. Syntax was still checked.",
    };
  }

  // The local provider and config discovery both read the working directory.
  const previous = process.cwd();
  process.chdir(dir);
  try {
    let providers;
    const found = lib.loadConfigFrom?.(dir);
    if (found) providers = lib.buildProviders(found.config, { configDir: path.dirname(found.path) });
    const engine = new lib.SecRefs(providers ? { providers } : {});
    const results = await engine.check(Object.fromEntries(entries));
    return {
      results: results.map((r) => ({
        key: r.key,
        ref: r.ref,
        ok: r.ok,
        ...(r.message ? { message: r.message } : {}),
      })),
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  } finally {
    process.chdir(previous);
  }
}

export async function callTool(name, args = {}) {
  switch (name) {
    case "parse_ref":
      return parseRef(args.ref);

    case "list_aliases":
      return listAliases(projectDir(args));

    case "check_refs": {
      const dir = projectDir(args);
      const refs = Array.isArray(args.refs) ? args.refs : [];
      const invalid = refs
        .map((ref) => ({ ref, ...parseRef(ref) }))
        .filter((r) => r.error)
        .map(({ ref, error }) => ({ ref, ok: false, message: error }));
      const valid = refs.filter((ref) => !parseRef(ref).error);
      if (valid.length === 0) return { results: invalid };
      const checked = await checkWithLibrary(valid.map((ref, i) => [`REF_${i}`, ref]), dir);
      if (checked.error) return { results: invalid, error: checked.error };
      return { results: [...invalid, ...checked.results.map(({ key, ...rest }) => rest)] };
    }

    case "check_env_file": {
      const dir = projectDir(args);
      const file = path.resolve(dir, args.path ?? ".env");
      if (!existsSync(file)) return { error: `${path.relative(dir, file)} does not exist` };
      const text = readFileSync(file, "utf8");

      const refs = [];
      const literalSecrets = [];
      text.split(/\r?\n/).forEach((line, i) => {
        const a = parseAssignment(line);
        if (a?.value?.startsWith("sec://")) refs.push([a.key, a.value]);
        else if (findLiteralSecrets(line, file).length) literalSecrets.push({ line: i + 1, key: a?.key });
      });

      const checked = refs.length ? await checkWithLibrary(refs, dir) : { results: [] };
      return {
        file: path.relative(dir, file),
        ...checked,
        literalSecrets,
        ...(literalSecrets.length
          ? { hint: "These variables hold literal secrets. /secrefs:migrate moves them to references." }
          : {}),
      };
    }

    default:
      throw Object.assign(new Error(`unknown tool "${name}"`), { code: -32602 });
  }
}

async function handle(message) {
  const { id, method, params } = message;
  switch (method) {
    case "initialize":
      return {
        protocolVersion: params?.protocolVersion ?? DEFAULT_PROTOCOL,
        capabilities: { tools: {} },
        serverInfo: SERVER,
        instructions:
          "Tools for sec:// secret references. None of them returns a secret value. " +
          "Use list_aliases before choosing an alias, and check_refs after writing references.",
      };
    case "ping":
      return {};
    case "tools/list":
      return { tools: TOOLS };
    case "tools/call": {
      try {
        const result = await callTool(params?.name, params?.arguments ?? {});
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          isError: Boolean(result?.error) && !result?.results?.length,
        };
      } catch (err) {
        if (err.code) throw err;
        return { content: [{ type: "text", text: `error: ${err.message}` }], isError: true };
      }
    }
    default:
      if (id === undefined) return undefined; // a notification
      throw Object.assign(new Error(`method not found: ${method}`), { code: -32601 });
  }
}

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

function main() {
  const rl = createInterface({ input: process.stdin });
  rl.on("line", async (line) => {
    if (!line.trim()) return;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } });
      return;
    }
    try {
      const result = await handle(message);
      if (message.id !== undefined && result !== undefined) send({ jsonrpc: "2.0", id: message.id, result });
    } catch (err) {
      if (message.id !== undefined) {
        send({ jsonrpc: "2.0", id: message.id, error: { code: err.code ?? -32603, message: err.message } });
      }
    }
  });
}

if (process.argv[1]?.endsWith("mcp.mjs")) main();
