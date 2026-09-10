# Transcripts are a credential sink

npm wanted a one-time password.

I typed six digits. npm said they were wrong, or expired — it doesn't
distinguish, which is its own small cruelty. I generated another set, and by the
time I'd pasted those the publish had timed out. On the third go I stopped
fighting it and pasted the token into the chat instead, and told the agent to
use that.

It published the package. Then it published the second one. Then it carried on
with the rest of the afternoon's work, and the token sat there in the
conversation for two more days before I remembered to go and revoke it.

Nothing came of it. Nobody found it, nothing got compromised, and this isn't a
war story. I'm writing it down because of how completely reasonable the decision
felt at the time, and because I was — that same week, in that same repository —
building a tool whose entire purpose is stopping people from doing that.

## The part I keep coming back to

I've leaked credentials in most of the usual ways. Committed an `.env` once.
Left a key in a Slack thread. Both were embarrassing and both were fixable in
about ten minutes, because we've spent twenty years building the fixes.

Push protection catches the commit before it lands. `git filter-repo` and a
force-push handle it if it does. Logs have redaction filters and retention
windows. CI masks secrets in output. GitHub will email you if it finds your AWS
key on a public repo. None of this is perfect but it's *there*, and it's mostly
automatic.

There is nothing like that for a conversation.

You can't rewrite it, because you don't own the storage and there's no operation
that reaches in and removes a string. You can't age it out, because the retention
policy isn't yours either. Nothing scans it. Nothing warns you.

And it doesn't sit still. This is the part I underestimated: a transcript gets
re-read constantly. Every turn feeds it back through. Resuming a session pulls it
up again. Long sessions get summarised into new contexts that carry pieces
forward. Then there's the ordinary human traffic — you screenshot a bit of it for
a bug report, paste a chunk into another chat to ask why something failed,
forward it to someone who's better at Terraform than you are.

One paste, read back an unknowable number of times, in an unknowable number of
places.

## "Just don't paste secrets into the chat"

Sure. I know.

But look at what I was actually doing. I was three OTP attempts into a publish
that should have taken thirty seconds, in the middle of a longer piece of work,
and the token was sitting right there in my password manager. The rule wasn't
competing with laziness. It was competing with a broken 2FA flow at the exact
moment I'd stopped caring about anything except getting the package out.

Agents publish things, run migrations, hit production APIs, deploy. Those jobs
need credentials, and the only way we've offered to supply one is to hand over
the string. So the rule gets broken — not by people who don't know better, but by
people who know better and are busy.

If your control only works when someone is paying attention, you don't have a
control. You have a preference.

## What I actually wanted

The thing I was trying to give that agent wasn't a token. It was the ability to
publish a package. Those aren't the same, they're just usually delivered
together.

So: give it a name for the credential instead of the credential.

```bash
# .env — safe to commit, safe to paste, safe to screenshot
NPM_TOKEN=sec://aws/npm/ci#token
```

```bash
secrefs run -- npm publish
```

The reference gets resolved at the moment of use, from a vault that decides
independently whether the machine asking is allowed to have it. The child process
gets a real token. The transcript, the `.env`, and my shell history get a string
that's worth nothing to anyone who can't already authenticate to my AWS account.

Same publish. Nothing durable left behind.

## Where this stops working

It moves the credential rather than removing it. Something still has to authorize
that fetch — usually the machine's own cloud credentials. What changes is the
shape of the exposure: instead of a long-lived token in a document I can't purge,
there's a short-lived credential scoped by an identity provider I already run and
already rotate. Better. Not zero. If you were hoping for zero, I don't have it.

If the agent decides to print the resolved value, it's back in the transcript and
we've achieved nothing. This closes the path secrets actually escape through —
config files, environment setup, the pasted-in-a-hurry token — not deliberate
output.

And anything with code execution on my laptop can read the value out of memory
just as easily as it could have read it out of `.env`. The threat here is the
record, not the machine.

## Why bother

Most of the security conversation around agents right now is about what they're
allowed to *do*. Permissions, sandboxes, approval prompts, tool allowlists. All
reasonable. But there's very little about what they're allowed to *know*, and
almost nothing about what happens to that knowledge after the task is finished.

The second problem is the easier one. It mostly needs the tooling to stop making
"paste the live secret" the fastest path.

I'd have taken that option on the third OTP failure. I'd have taken it happily.

---

SecRefs is Apache-2.0 licensed and reads from the vault you already run — AWS Secrets
Manager, HashiCorp Vault, or Bitwarden. It stores nothing.

```bash
npm install @secrefs/node
pip install secrefs
```

[secrefs.com/agents](https://secrefs.com/agents) ·
[github.com/secrefs/secrefs](https://github.com/secrefs/secrefs)
