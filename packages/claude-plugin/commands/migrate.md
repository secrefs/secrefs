---
description: Replace plaintext secrets in a .env file with sec:// references, without the values passing through Claude
argument-hint: "[env-file] [--alias <alias>] [--prefix <path-prefix>]"
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/migrate.mjs":*), mcp__plugin_secrefs_secrefs__list_aliases, mcp__plugin_secrefs_secrefs__check_env_file, mcp__plugin_secrefs_secrefs__check_refs
---

Migrate the plaintext secrets in an env file to SecRefs references.

Arguments: `$ARGUMENTS` (the first argument is the env file; default `.env`).

**Do not Read, cat, grep or otherwise display the env file.** It holds
plaintext secrets. Everything you need comes from the migrate script, whose
output never contains a value.

1. Plan. Run:

   ```
   node "${CLAUDE_PLUGIN_ROOT}/scripts/migrate.mjs" plan <env-file> [--alias <alias>] [--prefix <prefix>]
   ```

   It prints each variable's name, line, kind (`secret`, `config`,
   `reference`, `empty`, `multi-line`, `invalid-reference`) and, for
   secrets, a suggested reference. It also lists the project's aliases.

2. Propose a mapping. Show the user a table of the `secret` variables with
   the reference you suggest for each. Improve on the script's suggestion
   where you can:
   - Use an alias that exists (`aliases` in the plan). Prefer the one that
     matches the file: `.env.production` likely maps to a production alias.
   - Group related values into one JSON secret with fields, the way the
     vault usually holds them: `DB_HOST`/`DB_PASSWORD` become
     `sec://aws/prod/db#host` and `sec://aws/prod/db#password`.
   - If the user has no vault set up yet, offer the `local` alias. Its
     values move into the gitignored `.secrefs.local.json`, and the
     references work immediately.

   Say which variables you are leaving alone (`config` values) and flag any
   `multi-line` or `invalid-reference` entries for the user to handle.
   Wait for the user to confirm or edit the mapping.

3. Apply. Run, with the confirmed mapping as one JSON object:

   ```
   node "${CLAUDE_PLUGIN_ROOT}/scripts/migrate.mjs" apply <env-file> --map '{"KEY":"sec://alias/path#field"}'
   ```

   It rewrites only the mapped lines. Values for `local` aliases move into
   that alias's file. For every other alias the original lines go to
   `<env-file>.pre-secrefs`, readable only by the owner.

4. Hand off. From the apply output:
   - List `toStore` as the user's next step: for each entry, the alias,
     path and JSON field where the value must be stored in their vault,
     taken from the backup file. Tell them to delete the backup afterwards.
   - Repeat any `warnings` (for example, a file that isn't gitignored).

5. Verify. Call `check_env_file` on the env file. References to `local`
   should resolve now. Others resolve once the user has stored the values.
   Report which still fail and why.
