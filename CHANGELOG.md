# Changelog

## Unreleased

### Added

- **Claude Code plugin** (`packages/claude-plugin`), installed with
  `/plugin install secrefs --marketplace secrefs/secrefs`. A PreToolUse guard
  refuses edits that would write a literal secret into a file. A skill teaches
  the reference syntax and aliases. `/secrefs:migrate` moves a `.env` to
  references without the values passing through the conversation. MCP tools
  check references resolve and never return a value.
- **Vaultwarden provider** (`sec://vaultwarden/...`, Node and Python). Reads
  items from a Vaultwarden or Bitwarden password vault through the official
  `bw` CLI, using the session from `bw unlock --raw`. Vaultwarden doesn't
  implement Bitwarden Secrets Manager, so the `bitwarden` provider can't reach
  it. Items are addressed by exact name, `folder/name` or id. Fields cover the
  login's parts, custom fields and JSON in notes. A `serverUrl` in
  `secrefs.config.json` stops an alias from reading a different server. Added
  to the default aliases. The Claude Code guard now also flags a literal
  `BW_SESSION`.
- **1Password provider** (`sec://1password/<vault>/<item>[/<section>]#<field>`,
  Node and Python), through 1Password's official SDK. Authenticates with a
  service account token (`OP_SERVICE_ACCOUNT_TOKEN`), or through the desktop
  app (`OP_ACCOUNT`), which asks you to approve. References requested together
  are resolved in one call. Python needs `secrefs[1password]`. Added to the
  default aliases. The Claude Code guard now also flags 1Password service
  account tokens.

## 0.3.0

### Changed

- **Relicensed from MIT to Apache-2.0.** Minor rather than patch: a licence
  change alters the terms you are bound by, and a patch release implies there
  is nothing to look at.

  Apache-2.0 grants patent rights explicitly where MIT is silent, terminates
  that grant for anyone who sues over patents in the code, and withholds
  trademark rights explicitly. All three matter more for a dependency that
  handles credentials than they would for a general utility. Nothing narrows
  for users - Apache-2.0 sits on the same corporate pre-approved lists MIT
  does.

  **0.1.0 and 0.2.0 remain MIT permanently.** This applies from 0.3.0 onward.
  See LICENSING.md.

- Each published package now ships a `NOTICE` file alongside its `LICENSE`,
  per Apache convention.

No functional changes to the libraries in this release.

## 0.2.0

Minor rather than patch: this adds features and narrows a compatibility
claim, and calling that a patch would misrepresent it.

### Added

- **`secrefs.config.json`** — project configuration for the CLI. Declares
  provider aliases, so `secrefs run` can reach more than one AWS account or
  Bitwarden vault. Credentials are named by the environment variable that
  holds them, never written into the file, and credential-shaped keys are
  rejected outright rather than ignored.
- **`profile`** option on the AWS provider, for addressing multiple accounts.
- **Error classification.** A failed fetch now carries `kind` — `auth`,
  `not_found`, `denied`, `transient`, `unknown` — and a `remedy` for auth
  failures. An expired SSO session is reported once for the provider with the
  command that fixes it, instead of once per reference blaming healthy secrets.
- **`staleGraceMs`.** After a *failed* refresh, a value fetched within the
  window may be served instead of throwing — for transient faults only. Never
  for auth or denial, since a stale value there hides a change the operator has
  to act on. Off by default.

### Changed

- **`engines` narrowed from `>=18` to `>=20`.** Node 18 and 20 are both past
  end-of-life; the previous claim was one nothing verified. CI now runs a
  20/22/24 matrix, which immediately caught a `better-sqlite3` crash on Node 24.
- `AccessDenied` is deliberately classified as a path failure, not an auth
  failure — the credentials worked and a policy refused one secret.

### Fixed

- `better-sqlite3` upgraded to 12.x; 11.x crashed at teardown on Node 24.
- The `bin` path no longer carries a `./` prefix npm was silently rewriting.

## 0.1.0

Initial release. `sec://` reference parsing and resolution, AWS Secrets
Manager / HashiCorp Vault / Bitwarden Secrets Manager / local providers,
`secrefs run` and `secrefs check`, and Python parity.
