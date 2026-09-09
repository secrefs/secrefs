# Transcripts are a credential sink

A few days ago I pasted an npm token with publish rights into a chat with a
coding agent.

I knew better. I'd spent that same week building a tool whose entire purpose is
stopping people from doing exactly that. The agent was mid-task, the publish was
blocked on auth, and typing the token was the fastest way to unblock it. So I
typed it.

The agent used it three times. The task worked. And the token sat in that
transcript — a live credential with publish rights to two packages — until I
revoked it two days later.

Nothing bad happened. But I want to be precise about *why* nothing bad happened:
I got lucky, and I noticed. Neither of those is a control.

## This is not the leak you already know how to handle

Every other place a secret escapes to, we have a remedy for. Secrets in Git get
caught by push protection and purged with `git filter-repo`. Secrets in logs get
scrubbed by a redaction filter and aged out by retention. Secrets in CI get
masked in output.

A secret in a transcript has four properties that break all of that.

**You can't rewrite it.** There is no `filter-repo` for a conversation. The
storage isn't yours, the format isn't yours, and there's no operation that
reaches into the record and removes a string.

**It gets replayed.** This is the one people underestimate. A transcript isn't
written once and filed. It's re-read on every turn, restored when a session
resumes, summarised into new contexts when it gets long, and carried into
whatever comes next. One paste is read back hundreds of times, in places you
never explicitly sent it.

**It gets shared.** Sessions end up in screenshots for a bug report, pasted into
another chat to ask why something failed, forwarded to a colleague, attached to
a support ticket. Every hop is a copy you cannot recall.

**Nothing tells you it leaked.** No scanner. No alert. No push protection. A
credential in a transcript looks exactly like a credential doing its job — right
up until it isn't. I only knew about mine because I was the one who pasted it.

Put together: it's a credential sink with no purge, unbounded replay, silent
propagation, and no detection. That's a genuinely new shape, and it arrived with
agents.

## "Don't paste secrets into the chat" is a wish, not a policy

The obvious response is a rule. Don't do that.

It won't hold, and it's worth understanding why rather than assuming people are
careless.

Agents deploy things. They publish packages, run migrations, query production,
call APIs, provision infrastructure. Those tasks *require* credentials. Telling
someone not to supply one is telling them not to use the tool for the work they
adopted it to do. So the rule gets broken — not by careless people, but by
focused ones, at the exact moment their attention is on something else entirely.

Any control that depends on a human being disciplined at their least disciplined
moment is not a control.

I say this as someone who broke my own rule while building the tool that
enforces it. The rule wasn't the problem. The interface was.

## The agent needs the capability, not the value

Here's the reframe that makes this tractable.

When you paste a token to an agent, you're not trying to give it a string.
You're trying to give it the *ability to publish*. The string is just the only
mechanism we've offered.

Those are separable. The agent can hold a **reference** to a credential —
something that names the secret without being the secret — and resolve it at the
moment of use, from a vault that authorizes the resolution independently.

```bash
# not this
NPM_TOKEN=npm_8Fq2xKd0sLpQm4vX1nRb...

# this
NPM_TOKEN=sec://aws/npm/ci#token
```

Run the task through something that resolves the reference:

```bash
secrefs run -- npm publish
```

The child process gets the real token in memory. The transcript, the config
file, and the shell history all hold a pointer that is inert without access to
the vault — access granted by your cloud identity, not by possession of the
document.

Same outcome. The credential never becomes a permanent part of the record.

## What this doesn't do

I'd rather say this plainly than have a security reviewer find it in the first
five minutes.

**It moves the credential, it doesn't remove one.** Something still has to
authorize the fetch — usually the machine's ambient cloud credentials. What
changes is the *shape*: one long-lived token in an unpurgeable document becomes
a short-lived credential scoped by your existing identity provider and expiring
on its own. Strictly better. Not zero.

**An agent that prints the value leaks it again.** Resolution puts a real string
in a process. If the agent then echoes it, it's back in the transcript. This
closes the path secrets normally escape through — config, environment, pasted
setup — not deliberate output.

**Local compromise still wins.** Anything with code execution on the machine can
read a resolved value out of memory, exactly as it could read a token from
`.env`. The threat model here is the *record*, not the host.

What's left after those caveats is still the thing that actually bit me: the
credential that outlives the task, in a document nobody can purge.

## Why this is worth doing now

Two things are true at once. Agents are being handed production credentials at a
rate that would have been unthinkable for any other class of tool. And the
security tooling around them is almost entirely about what the agent is allowed
to *do* — permissions, sandboxes, approval prompts — rather than what it's
allowed to *know*, and what happens to that knowledge afterward.

The second problem is easier. It just needs the interface to change so that
handing over a live secret stops being the path of least resistance.

Your agent gets the value. Your transcript gets the reference.

---

SecRefs is MIT-licensed and works with the vault you already run — AWS Secrets
Manager, HashiCorp Vault, or Bitwarden. It stores nothing and never holds a copy
of your secrets.

```bash
npm install @secrefs/node
pip install secrefs
```

[secrefs.com/agents](https://secrefs.com/agents) ·
[github.com/secrefs/secrefs](https://github.com/secrefs/secrefs)
