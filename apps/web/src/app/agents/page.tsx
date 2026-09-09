import type { Metadata } from "next";
import {
  ArrowRight,
  Copy,
  Eye,
  FileWarning,
  GitBranch,
  Repeat,
  ShieldOff,
  Users,
} from "lucide-react";
import SiteHeader from "@/components/SiteHeader";
import { TerminalWindow, Line, Prompt } from "@/components/Terminal";

export const metadata: Metadata = {
  title: "Transcripts are a credential sink - SecRefs for AI agents",
  description:
    "Every secret an AI agent touches gets written down somewhere you do not control and cannot purge. Give the agent a reference instead of a key.",
  openGraph: {
    title: "Transcripts are a credential sink",
    description:
      "Your agent gets the value. Your transcript gets the reference.",
    url: "https://secrefs.com/agents",
    siteName: "SecRefs",
    type: "article",
  },
};

const NAV_LINKS = [
  { href: "/#how-it-works", label: "How it works" },
  { href: "/#sandbox", label: "Sandbox" },
  { href: "/agents", label: "For agents" },
  { href: "/for-vendors", label: "For vendors" },
];

const WHY_DIFFERENT = [
  {
    icon: GitBranch,
    title: "You can't rewrite it",
    body: "A secret committed to Git can be purged and force-pushed. A secret in a transcript is in a record you don't own the storage for, with no equivalent of git filter-repo.",
  },
  {
    icon: Repeat,
    title: "It gets replayed",
    body: "Transcripts are re-read on every turn, restored when a session resumes, and summarised into new contexts. One paste is read back hundreds of times across places you never sent it.",
  },
  {
    icon: Users,
    title: "It gets shared",
    body: "Sessions end up in screenshots, bug reports, support threads, and pasted into other chats to ask what went wrong. Each hop is a copy you can't recall.",
  },
  {
    icon: Eye,
    title: "Nothing tells you it leaked",
    body: "There is no scanner for this, no push protection, no alert. A credential in a transcript looks exactly like a credential doing its job, right up until it isn't.",
  },
];

export default function AgentsPage() {
  return (
    <div className="relative min-h-screen overflow-hidden">
      <div className="pointer-events-none absolute inset-0 bg-grid bg-grid [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,black,transparent)]" />

      <SiteHeader links={NAV_LINKS} />

      {/* Hero */}
      <section className="relative z-10 mx-auto max-w-6xl px-6 pb-16 pt-20 sm:pt-24">
        <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-signal-500/20 bg-signal-500/5 px-3 py-1 text-xs font-medium text-signal-400">
          For teams running coding agents
        </div>
        <h1 className="glow-text max-w-3xl text-balance text-4xl font-bold leading-[1.1] tracking-tight text-white sm:text-5xl">
          Transcripts are a credential sink.
        </h1>
        <p className="mt-6 max-w-2xl text-lg leading-relaxed text-slate-400">
          Every secret your agent touches gets written down somewhere you don&apos;t control and
          can&apos;t purge. Not in a log you rotate — in a conversation that is stored, replayed,
          summarised, and shared.
        </p>

        {/* Signature: the same session, twice. */}
        <div className="mt-12 grid gap-6 lg:grid-cols-2">
          <div className="rounded-xl border border-red-500/20 bg-red-500/[0.03] p-6">
            <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-red-400">
              <Copy className="h-4 w-4" />
              What usually happens
            </div>
            <TerminalWindow title="session transcript">
              <Line dim>you</Line>
              <Line>use this token to publish: npm_8Fq2xKd0sLpQm4vX1nRb…</Line>
              <div className="h-3" />
              <Line dim>agent</Line>
              <Line dim>✓ published @acme/widget@1.4.2</Line>
              <div className="h-3" />
              <Line dim># the token is now a permanent part of</Line>
              <Line dim># this record, and every copy of it</Line>
            </TerminalWindow>
            <p className="mt-5 text-sm leading-relaxed text-slate-400">
              The task succeeded. A live publish credential is now sitting in a document that will
              outlive the task by years.
            </p>
          </div>

          <div className="rounded-xl border border-signal-500/20 bg-signal-500/[0.03] p-6">
            <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-signal-400">
              <ShieldOff className="h-4 w-4" />
              What should happen
            </div>
            <TerminalWindow title="session transcript">
              <Line dim>you</Line>
              <Line>publish using sec://aws/npm/ci#token</Line>
              <div className="h-3" />
              <Line dim>agent</Line>
              <Line dim>✓ published @acme/widget@1.4.2</Line>
              <div className="h-3" />
              <Line dim># the transcript holds a pointer.</Line>
              <Line dim># resolving it requires authorization</Line>
              <Line dim># that lives outside this document.</Line>
            </TerminalWindow>
            <p className="mt-5 text-sm leading-relaxed text-slate-400">
              Same outcome. The agent got a working credential; the record got a reference that is
              inert without access you control separately.
            </p>
          </div>
        </div>
      </section>

      {/* Why this is its own problem */}
      <section className="relative z-10 mx-auto max-w-6xl px-6 py-16">
        <h2 className="max-w-3xl text-balance text-3xl font-bold tracking-tight text-white">
          This isn&apos;t the leak you already know how to handle.
        </h2>
        <p className="mt-4 max-w-2xl text-slate-400">
          Every other place a secret escapes to has a remedy. This one has four properties that
          break all of them.
        </p>
        <div className="mt-10 grid gap-6 sm:grid-cols-2">
          {WHY_DIFFERENT.map((item) => (
            <div key={item.title} className="rounded-xl border border-white/10 bg-white/[0.02] p-6">
              <item.icon className="h-6 w-6 text-signal-400" />
              <h3 className="mt-4 font-semibold text-white">{item.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-400">{item.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* The reframe */}
      <section className="relative z-10 mx-auto max-w-6xl px-6 py-16">
        <div className="grid gap-10 lg:grid-cols-2 lg:items-center">
          <div>
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-signal-400">
              <FileWarning className="h-4 w-4" />
              Why the usual advice fails
            </div>
            <h2 className="text-balance text-3xl font-bold tracking-tight text-white">
              &ldquo;Don&apos;t paste secrets into the chat&rdquo; is not a policy. It&apos;s a
              wish.
            </h2>
            <div className="mt-5 space-y-4 text-slate-400">
              <p>
                Agents deploy things, publish packages, query production, and call APIs. Those
                tasks need credentials. Telling someone not to supply one is telling them not to
                use the tool for the work they bought it for — so they paste it anyway, at the
                moment they are most focused on something else.
              </p>
              <p>
                The mistake is treating this as a discipline problem. It&apos;s an interface
                problem:{" "}
                <span className="text-slate-200">
                  the agent needs the capability, not the value
                </span>
                . Handing over the value is just the only way we&apos;ve offered.
              </p>
            </div>
          </div>

          <TerminalWindow title="what the agent actually needs">
            <Line dim># not this</Line>
            <Line>NPM_TOKEN=npm_8Fq2xKd0sLpQm4vX1nRb…</Line>
            <div className="h-4" />
            <Line dim># this</Line>
            <Line>NPM_TOKEN=sec://aws/npm/ci#token</Line>
            <div className="h-4" />
            <Prompt>secrefs run -- npm publish</Prompt>
            <Line dim>secrefs: resolved 1 secret reference(s): NPM_TOKEN</Line>
            <Line>+ @acme/widget@1.4.2</Line>
          </TerminalWindow>
        </div>
      </section>

      {/* Honest limits */}
      <section className="relative z-10 mx-auto max-w-6xl px-6 py-16">
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.02] p-8 sm:p-10">
          <h2 className="text-balance text-2xl font-bold tracking-tight text-white">
            What this does not do
          </h2>
          <div className="mt-6 grid gap-6 text-sm leading-relaxed text-slate-400 sm:grid-cols-3">
            <div>
              <h3 className="mb-2 font-semibold text-white">It moves the credential, it doesn&apos;t remove it</h3>
              <p>
                Something still has to authorize the fetch — usually the machine&apos;s own cloud
                credentials. SecRefs converts one long-lived token in a permanent document into a
                short-lived credential scoped by your existing identity provider. Strictly better,
                not zero.
              </p>
            </div>
            <div>
              <h3 className="mb-2 font-semibold text-white">An agent that prints it, leaks it</h3>
              <p>
                Resolution puts a real value in the process. If the agent then echoes it, it&apos;s
                in the transcript again. This closes the path secrets normally escape through —
                config, environment, pasted setup — not deliberate output.
              </p>
            </div>
            <div>
              <h3 className="mb-2 font-semibold text-white">Local compromise still wins</h3>
              <p>
                Anything with code execution on the machine can read the resolved value out of
                memory, exactly as it could read a token from <code>.env</code>. The threat this
                addresses is the record, not the host.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="relative z-10 mx-auto max-w-6xl px-6 py-16">
        <div className="mx-auto max-w-3xl text-center">
          <h2 className="text-balance text-3xl font-bold tracking-tight text-white">
            Your agent gets the value. Your transcript gets the reference.
          </h2>
          <p className="mt-5 text-slate-400">
            Works with the vault you already run — AWS Secrets Manager, HashiCorp Vault, Bitwarden.
            SecRefs stores nothing and never holds a copy of your secrets.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
            <a
              href="/#quickstart"
              className="flex items-center gap-2 rounded-md bg-signal-500 px-5 py-3 text-sm font-semibold text-ink-950 transition hover:bg-signal-400"
            >
              Get started
              <ArrowRight className="h-4 w-4" />
            </a>
            <a
              href="/#sandbox"
              className="flex items-center gap-2 rounded-md border border-white/15 px-5 py-3 text-sm font-semibold text-white transition hover:border-white/30"
            >
              Try the sandbox
            </a>
          </div>
          <p className="mt-6 font-mono text-xs text-slate-600">
            npm install @secrefs/node · pip install secrefs
          </p>
        </div>
      </section>

      <footer className="relative z-10 border-t border-white/5">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 py-10 text-sm text-slate-500 sm:flex-row">
          <a href="/" className="font-mono text-slate-400 hover:text-white">
            secrefs.com
          </a>
          <div className="flex flex-wrap justify-center gap-6">
            <a href="/for-vendors" className="hover:text-white">
              For vendors
            </a>
            <a href="https://github.com/secrefs/secrefs" className="hover:text-white">
              GitHub
            </a>
            <span>MIT Licensed</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
