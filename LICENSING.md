# Licensing

This repository is dual-licensed. Which license applies depends on which
directory the code lives in, and every licensed directory carries its own
`LICENSE` file — that file is authoritative for its subtree.

| Path | License | What it is |
|---|---|---|
| `packages/node` | **Apache-2.0** | `@secrefs/node` — the Node.js client library and CLI |
| `packages/python` | **Apache-2.0** | `secrefs` — the Python client library and CLI |
| `apps/web` | **Apache-2.0** | The secrefs.com marketing site and sandbox |
| `apps/control-plane` | **BUSL-1.1** | The control plane API |
| `apps/control-plane-admin` | **BUSL-1.1** | The admin console |
| everything else | **Apache-2.0** | Docs, tooling, CI config |

## Why the split

**The libraries are Apache-2.0, permanently and unconditionally.** They are what
you put in your own applications, and nobody should have to think about
licensing to import a client library. Use them commercially, embed them in a
closed product, fork them — no permission needed, no strings.

Apache-2.0 rather than MIT for three reasons, all of which matter more for a
library that handles credentials than they would for a general utility:

- **It grants patent rights explicitly.** MIT is silent on patents, and that
  silence is a real question for the legal review a credential-handling
  dependency tends to attract. Apache-2.0 answers it in the licence text.
- **It has a patent retaliation clause.** If someone uses this code and then
  sues over patents in it, their grant terminates. That is defensive, not
  aggressive — it means a competitor cannot turn this project's own code
  against it.
- **It withholds trademark rights explicitly.** "SecRefs" is a name across a
  domain, an npm scope, a PyPI project and a GitHub organisation. MIT says
  nothing about marks; Apache-2.0 says the licence does not grant them.

None of this narrows what you can do with the code. Apache-2.0 is on the same
corporate pre-approved lists MIT is, and is the default for CNCF projects.

Versions published before this change remain MIT, and that does not expire —
`@secrefs/node@0.1.0`, `@secrefs/node@0.2.0` and `secrefs 0.2.0` on PyPI are
MIT forever. Everything from the next release onward is Apache-2.0.

**The control plane is source-available under the Business Source License.**
You can read all of it, audit it, modify it, and run it. The one thing you
cannot do without a commercial license is operate it as a business:

- **Free, no license needed** — running the control plane for yourself, your
  personal projects, or a non-profit hobby community. Also any non-production
  use: evaluating it, developing against it, running it in CI.
- **Requires a commercial license** — operating it in production in support of
  a commercial product or business, or offering it to others as a hosted
  service.

Contact **hello@secrefs.com** for a commercial license.

## The Change Date

Each BUSL-licensed version converts to **Apache 2.0 on 2030-09-01**, or four
years after that version was first published, whichever comes first. The
restriction above is time-limited by construction — every release eventually
becomes fully open source, and that is a term of the license, not a promise.

## Why source-available rather than closed

SecRefs handles credentials. Asking a security team to route their secrets
through a binary they cannot inspect is a bad trade, and one most of them will
refuse. The control plane is readable so that its claims are checkable — that
the authorization path is what the docs say it is, that audit records hold
decisions and never values. That auditability is worth more than the secrecy
would be.
