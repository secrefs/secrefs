import type { Metadata } from "next";
import SiteHeader from "@/components/SiteHeader";
import { TerminalWindow, Line, Prompt } from "@/components/Terminal";
import { ArticleShell, Code, H2, Pull, Strong } from "@/components/Article";

export const metadata: Metadata = {
  title: "Transcripts are a credential sink",
  description:
    "A secret pasted into an agent session lands in a record that can't be rewritten, gets replayed constantly, propagates by sharing, and triggers no alert. That's a new shape, and it arrived with agents.",
  openGraph: {
    title: "Transcripts are a credential sink",
    description:
      "I pasted an npm token with publish rights into a chat with a coding agent, the same week I was building the tool that prevents it.",
    url: "https://secrefs.com/articles/transcripts-are-a-credential-sink",
    siteName: "SecRefs",
    type: "article",
  },
};

const NAV_LINKS = [
  { href: "/#how-it-works", label: "How it works" },
  { href: "/agents", label: "For agents" },
  { href: "/for-vendors", label: "For vendors" },
  { href: "https://docs.secrefs.com", label: "Docs" },
];

export default function Article() {
  return (
    <div className="relative min-h-screen overflow-hidden">
      <div className="pointer-events-none absolute inset-0 bg-grid bg-grid [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,black,transparent)]" />
      <SiteHeader links={NAV_LINKS} />

      <ArticleShell
        title="Transcripts are a credential sink"
        standfirst="I pasted an npm token with publish rights into a chat with a coding agent — the same week I was building the tool whose entire purpose is stopping people from doing that."
        date="September 2026"
      >
        <p>
          I knew better. The agent was mid-task, the publish was blocked on auth, and typing the
          token was the fastest way to unblock it. So I typed it.
        </p>
        <p>
          The agent used it three times. The task worked. And the token sat in that transcript — a
          live credential with publish rights to two packages — until I revoked it two days later.
        </p>
        <p>
          Nothing bad happened. But I want to be precise about <em>why</em> nothing bad happened: I
          got lucky, and I noticed. Neither of those is a control.
        </p>

        <H2>This is not the leak you already know how to handle</H2>
        <p>
          Every other place a secret escapes to, we have a remedy for. Secrets in Git get caught by
          push protection and purged with <Code>git filter-repo</Code>. Secrets in logs get scrubbed
          by a redaction filter and aged out by retention. Secrets in CI get masked in output.
        </p>
        <p>A secret in a transcript has four properties that break all of that.</p>
        <p>
          <Strong>You can&apos;t rewrite it.</Strong> There is no <Code>filter-repo</Code> for a
          conversation. The storage isn&apos;t yours, the format isn&apos;t yours, and there&apos;s
          no operation that reaches into the record and removes a string.
        </p>
        <p>
          <Strong>It gets replayed.</Strong> This is the one people underestimate. A transcript
          isn&apos;t written once and filed. It&apos;s re-read on every turn, restored when a session
          resumes, summarised into new contexts when it gets long, and carried into whatever comes
          next. One paste is read back hundreds of times, in places you never explicitly sent it.
        </p>
        <p>
          <Strong>It gets shared.</Strong> Sessions end up in screenshots for a bug report, pasted
          into another chat to ask why something failed, forwarded to a colleague, attached to a
          support ticket. Every hop is a copy you cannot recall.
        </p>
        <p>
          <Strong>Nothing tells you it leaked.</Strong> No scanner. No alert. No push protection. A
          credential in a transcript looks exactly like a credential doing its job — right up until
          it isn&apos;t. I only knew about mine because I was the one who pasted it.
        </p>
        <p>
          Put together: a credential sink with no purge, unbounded replay, silent propagation, and no
          detection. That&apos;s a genuinely new shape, and it arrived with agents.
        </p>

        <H2>&ldquo;Don&apos;t paste secrets into the chat&rdquo; is a wish, not a policy</H2>
        <p>The obvious response is a rule. Don&apos;t do that.</p>
        <p>
          It won&apos;t hold, and it&apos;s worth understanding why rather than assuming people are
          careless.
        </p>
        <p>
          Agents deploy things. They publish packages, run migrations, query production, call APIs,
          provision infrastructure. Those tasks <em>require</em> credentials. Telling someone not to
          supply one is telling them not to use the tool for the work they adopted it to do. So the
          rule gets broken — not by careless people, but by focused ones, at the exact moment their
          attention is on something else entirely.
        </p>
        <Pull>
          Any control that depends on a human being disciplined at their least disciplined moment is
          not a control.
        </Pull>
        <p>
          I say this as someone who broke my own rule while building the tool that enforces it. The
          rule wasn&apos;t the problem. The interface was.
        </p>

        <H2>The agent needs the capability, not the value</H2>
        <p>
          When you paste a token to an agent, you&apos;re not trying to give it a string. You&apos;re
          trying to give it <em>the ability to publish</em>. The string is just the only mechanism
          we&apos;ve offered.
        </p>
        <p>
          Those are separable. The agent can hold a <Strong>reference</Strong> to a credential —
          something that names the secret without being the secret — and resolve it at the moment of
          use, from a vault that authorizes the resolution independently.
        </p>

        <div className="!my-8">
          <TerminalWindow title=".env">
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

        <p>
          The child process gets the real token in memory. The transcript, the config file, and the
          shell history all hold a pointer that is inert without access to the vault — access granted
          by your cloud identity, not by possession of the document.
        </p>
        <p>Same outcome. The credential never becomes a permanent part of the record.</p>

        <H2>What this doesn&apos;t do</H2>
        <p>
          I&apos;d rather say this plainly than have a security reviewer find it in the first five
          minutes.
        </p>
        <p>
          <Strong>It moves the credential, it doesn&apos;t remove one.</Strong> Something still has
          to authorize the fetch — usually the machine&apos;s ambient cloud credentials. What changes
          is the shape: one long-lived token in an unpurgeable document becomes a short-lived
          credential scoped by your existing identity provider and expiring on its own. Strictly
          better. Not zero.
        </p>
        <p>
          <Strong>An agent that prints the value leaks it again.</Strong> Resolution puts a real
          string in a process. If the agent then echoes it, it&apos;s back in the transcript. This
          closes the path secrets normally escape through — config, environment, pasted setup — not
          deliberate output.
        </p>
        <p>
          <Strong>Local compromise still wins.</Strong> Anything with code execution on the machine
          can read a resolved value out of memory, exactly as it could read a token from{" "}
          <Code>.env</Code>. The threat model here is the <em>record</em>, not the host.
        </p>
        <p>
          What&apos;s left after those caveats is still the thing that actually bit me: the credential
          that outlives the task, in a document nobody can purge.
        </p>

        <H2>Why this is worth doing now</H2>
        <p>
          Two things are true at once. Agents are being handed production credentials at a rate that
          would have been unthinkable for any other class of tool. And the security tooling around
          them is almost entirely about what the agent is allowed to <em>do</em> — permissions,
          sandboxes, approval prompts — rather than what it&apos;s allowed to <em>know</em>, and what
          happens to that knowledge afterward.
        </p>
        <p>
          The second problem is easier. It just needs the interface to change so that handing over a
          live secret stops being the path of least resistance.
        </p>
        <Pull>Your agent gets the value. Your transcript gets the reference.</Pull>

        <div className="!mt-14 rounded-xl border border-white/10 bg-white/[0.02] p-6 text-[0.95rem] leading-relaxed text-slate-400">
          <p>
            <Strong>SecRefs</Strong> is MIT-licensed and works with the vault you already run — AWS
            Secrets Manager, HashiCorp Vault, or Bitwarden. It stores nothing and never holds a copy
            of your secrets.
          </p>
          <p className="mt-3 font-mono text-sm text-slate-500">
            npm install @secrefs/node
            <br />
            pip install secrefs
          </p>
          <p className="mt-4 flex flex-wrap gap-4 text-sm">
            <a href="/agents" className="text-signal-400 hover:text-signal-300">
              How it works for agents →
            </a>
            <a href="https://docs.secrefs.com" className="text-signal-400 hover:text-signal-300">
              Documentation →
            </a>
            <a
              href="https://github.com/secrefs/secrefs"
              className="text-signal-400 hover:text-signal-300"
            >
              GitHub →
            </a>
          </p>
        </div>
      </ArticleShell>

      <footer className="relative z-10 border-t border-white/5">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 py-10 text-sm text-slate-500 sm:flex-row">
          <a href="/" className="font-mono text-slate-400 hover:text-white">
            secrefs.com
          </a>
          <div className="flex flex-wrap justify-center gap-6">
            <a href="/articles" className="hover:text-white">
              Articles
            </a>
            <a href="https://docs.secrefs.com" className="hover:text-white">
              Docs
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
