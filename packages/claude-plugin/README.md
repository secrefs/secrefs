# SecRefs for Claude Code

A Claude Code plugin that keeps secrets out of the files Claude writes. Claude
writes `sec://` references to your own vault instead of plaintext values, and
never needs to see a secret to do it.

## Install

In Claude Code:

```
/plugin install secrefs --marketplace secrefs/secrefs
```

Answer `y` to add the marketplace, then pick a scope. The plugin needs Node.js
20 or later and has no dependencies of its own. To check that references
resolve, it uses the `@secrefs/node` installed in your project.

## What it adds

| Piece | What it does |
|---|---|
| **Guard** (PreToolUse hook) | Refuses any `Write`, `Edit`, `MultiEdit` or `NotebookEdit` that would put a literal secret into a file. It tells Claude the file, line, variable and kind of secret, and asks for a reference instead. It never repeats the value. |
| **`secrefs` skill** | Teaches Claude the reference syntax, your aliases and `secrefs.config.json`, `secrefs run` / `secrefs check`, and what each kind of resolution failure means. |
| **`/secrefs:migrate [file]`** | Moves plaintext secrets in a `.env` file to references. Claude only sees variable names and suggested references; the values move between files on disk without passing through the conversation. |
| **MCP tools** | `parse_ref`, `list_aliases`, `check_refs`, `check_env_file`. They report whether references are well formed and whether they resolve, and none of them can return a secret value. |

### What the guard looks for

- Token formats that are secrets in any file: private keys, AWS access key
  IDs, GitHub, Anthropic, OpenAI, Stripe live, Slack, Google, npm, HashiCorp
  Vault and Bitwarden tokens, Slack webhook URLs, and URLs with an inline
  password.
- In env files (`.env`, `.env.*`, `*.env`, `.envrc`), any variable whose name
  says it is a credential (`*_PASSWORD`, `*_SECRET`, `*_TOKEN`, `*_API_KEY`
  and so on) and whose value is not a reference, an interpolation like
  `${VAR}`, or an obvious placeholder.

Names that hold something other than a secret are left alone: `*_ENV`,
`*_ID`, `*_FILE`, `*_URL`, `*_REGION` and similar.

### Turning it off

- For one line: add a `secrefs:allow` comment, for example on a test fixture.
- For a session: start Claude Code with `SECREFS_GUARD=off`.
- Entirely: `/plugin disable secrefs`.

If the guard cannot read its input, it lets the call through and writes a note
to stderr rather than blocking every edit.

## How `/secrefs:migrate` keeps values out of the conversation

1. `plan` prints each variable's name, kind and a suggested reference, and no
   values.
2. Claude proposes references, grouping related values into JSON fields
   (`sec://aws/prod/db#host`, `#password`), and you confirm them.
3. `apply` rewrites only the confirmed lines.
   - For a `local` alias, it moves each value into that alias's gitignored
     JSON file, so the reference works immediately.
   - For any other alias, it copies the original lines to
     `<file>.pre-secrefs`, readable only by you, and lists the alias, path and
     field where each value belongs. Store them in your vault, then delete the
     backup.
4. `check_env_file` confirms which references resolve.

## Development

```bash
pnpm --filter @secrefs/claude-plugin test
claude --plugin-dir packages/claude-plugin      # load from this checkout
claude plugin validate packages/claude-plugin
```

The plugin carries its own copy of the reference grammar so it works without
the library installed. `test/parity.test.mjs` holds that copy to
`@secrefs/node`'s parser.

## License

Apache-2.0. See [LICENSE](LICENSE).
