---
name: secrefs
description: How to handle secrets in a project that uses SecRefs sec:// references. Use when writing or editing .env files, config, CI or deployment files that need a password, token, API key or other credential; when adding a new secret; when the SecRefs guard blocks an edit; or when a sec:// reference fails to resolve.
---

# Secrets as sec:// references

SecRefs replaces a secret in config with a reference to where the secret is
stored. The reference is safe to commit. The value is fetched from the
user's own vault, in memory, at the moment it is used.

```diff
- DB_PASSWORD=correcthorsebatterystaple
+ DB_PASSWORD=sec://aws/prod/db#password
```

## Rules

1. **Never write a literal secret into a file.** Write a reference. The
   plugin's guard refuses edits that contain one and says which line.
2. **Never bring a secret value into the conversation.** Don't `cat` or Read
   a `.env` that holds plaintext, and don't run anything that prints
   resolved values (`secrefs run -- env`, `printenv`, `echo $DB_PASSWORD`,
   debug logging of `process.env`). To see what a `.env` holds, use the
   `check_env_file` tool, which reports names and status only.
3. **A new secret goes into the vault by the user's hand, not yours.** Pick
   the alias and path, tell the user exactly where to store the value (alias,
   path, JSON field), and write the reference. Ask them not to paste the
   value into the chat.
4. **Confirm references resolve** with `check_refs` (or `check_env_file`)
   after writing them. A reference that does not resolve fails at startup.

## Reference syntax

```
sec://<alias>/<path>[#<field>]
```

- `alias`: a provider alias. Letters, digits, `-` and `_`, starting with a
  letter or digit. Case-insensitive.
- `path`: the secret's name or path as the backend knows it. No spaces and
  no `#`.
- `field` (optional): a key inside a JSON secret. Dot notation reaches
  nested keys: `#db.password`.

| Reference | Means |
|---|---|
| `sec://aws/prod/db#password` | AWS Secrets Manager secret `prod/db`, JSON key `password` |
| `sec://aws-staging/stripe` | Whole value of `stripe` in the account behind alias `aws-staging` |
| `sec://vault/secret/data/stripe#key` | HashiCorp Vault KV v2 path, field `key` |
| `sec://bitwarden/<secret-uuid>` | Bitwarden Secrets Manager secret by id |
| `sec://vaultwarden/prod/stripe#api_key` | Vault item `stripe` in folder `prod`, custom field `api_key` |
| `sec://local/mock-db#password` | Key `mock-db` in the gitignored `.secrefs.local.json` |

In a `.env` file the reference can be unquoted. SecRefs' own parser keeps
the `#field`. Other dotenv tools read an unquoted ` #` as a comment, so
quote the value (`KEY="sec://aws/prod/db#password"`) if anything else reads
the file, and never put a trailing comment on the same line as an unquoted
reference.

## Aliases and configuration

Call `list_aliases` before choosing an alias. Without a config file the
aliases are the five built-ins:

| Alias | Backend | Auth comes from |
|---|---|---|
| `aws` | AWS Secrets Manager | The default AWS credential chain |
| `vault` | HashiCorp Vault | `VAULT_ADDR`, `VAULT_TOKEN` |
| `bitwarden` | Bitwarden Secrets Manager | `BWS_ACCESS_TOKEN`, `BWS_ORGANIZATION_ID` |
| `vaultwarden` | Vaultwarden, or any Bitwarden password vault, through the `bw` CLI | `BW_SESSION` from `bw unlock --raw` |
| `local` | `.secrefs.local.json`, gitignored | Nothing. Development only |

A committed `secrefs.config.json` replaces the built-ins with named aliases,
so a project can reach several accounts:

```json
{
  "providers": {
    "aws-prod":    { "type": "aws", "profile": "acme-prod", "region": "us-east-1" },
    "aws-staging": { "type": "aws", "profile": "acme-staging" },
    "bw":          { "type": "bitwarden", "tokenEnv": "BWS_TOKEN_TEAM_A" },
    "vw":          { "type": "vaultwarden", "serverUrl": "https://vault.example.com" },
    "dev":         { "type": "local", "file": ".secrefs.local.json" }
  }
}
```

This file never holds a credential. Settings name the env var or AWS
profile that carries one (`tokenEnv`, `organizationIdEnv`, `sessionEnv`, `profile`), and
the library rejects a config with an inline secret. Never add a token,
password or key to it.

### Vaultwarden and Bitwarden password vaults

Vaultwarden doesn't implement Bitwarden Secrets Manager, so the `bitwarden`
alias can't reach it. Use a `vaultwarden` alias, which reads vault items
through the user's unlocked `bw` CLI. It works with bitwarden.com vaults too.

- Path: the item's exact name, `<folder>/<name>` when the name is used in
  more than one folder, or the item id. Names with spaces need the id.
- Field: none for a login's password or a note's text; `#username`, `#uri`,
  `#totp`, `#notes`; or the name of a custom field, or a key in a note that
  holds JSON.
- Never run `bw login`, `bw unlock`, `bw get` or `bw list` yourself: they
  print the session key or decrypted items. When the vault is locked, ask
  the user to run `export BW_SESSION="$(bw unlock --raw)"` in their own
  shell.

## Running code with references

- `npx secrefs run -- <command>` loads `.env`, resolves its references and
  starts the command with the values in its environment.
- `npx secrefs check` validates every reference and prints ok or a
  classified error per variable. It never prints values.
- In Node, `secRefs.expandString("sec://...")` resolves at the moment of
  use, so a rotated value reaches a long-running process without a restart.
  `await secRefs.init()` resolves `process.env` once at startup.
- In Python, the `secrefs` package has the same API, and its CLI is
  `secrefs-py`.

Prefer use-time resolution (`expandString`) for long-running services and
load-time resolution (`secrefs run`, `init()`) for short jobs such as CI.

## When something fails

`check_refs` and `secrefs check` classify failures. Act on the class:

- **Cannot authenticate** (expired SSO session, missing token): the user
  must refresh credentials, for example `aws sso login --profile <profile>`
  or, for `vaultwarden`, unlocking `bw` again.
  Don't change the reference.
- **Not found / no entry for path**: the path or alias is wrong, or the
  value hasn't been stored yet. Check `list_aliases` and the path with the
  user.
- **Field missing / not JSON**: the secret exists but has no such key.
  Drop or fix the `#field`.
- **AccessDenied**: the credentials work and a policy refuses this secret.
  This is an IAM question for the user, not a reference problem.
- **Unknown provider**: the alias isn't configured. Use one from
  `list_aliases` or add it to `secrefs.config.json`.

## When the guard blocks an edit

The guard names the file, line, variable and kind of secret it saw. Write a
reference in its place. If the match is a false positive (a test fixture, a
documented example, a public identifier), add a `secrefs:allow` comment on
that line and say why in the comment.
