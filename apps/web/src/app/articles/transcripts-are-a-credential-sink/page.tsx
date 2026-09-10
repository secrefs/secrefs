import type { Metadata } from "next";
import SiteHeader from "@/components/SiteHeader";
import { TerminalWindow, Line, Prompt } from "@/components/Terminal";
import { ArticleShell, Code, H2, Pull, Strong } from "@/components/Article";

export const metadata: Metadata = {
  title: "Transcripts are a credential sink",
  description:
    "I pasted an npm token into a chat with a coding agent because the OTP flow kept failing. It sat there for two days. We have twenty years of tooling for every other kind of leak and none for this one.",
  openGraph: {
    title: "Transcripts are a credential sink",
    description:
      "npm wanted a one-time password. On the third attempt I pasted the token into the chat instead.",
    url: "https://secrefs.com/articles/transcripts-are-a-credential-sink",
    siteName: "SecRefs",
    type: "article",
  },
};

const NAV_LINKS = [
  { href: "/#how-it-works", label: "How it works" },
  { href: "/agents", label: "For agents" },
  { href: "/articles", label: "Articles" },
  { href: "https://docs.secrefs.com", label: "Docs" },
];

export default function Article() {
  return (
    <div className="relative min-h-screen overflow-hidden">
      <div className="pointer-events-none absolute inset-0 bg-grid bg-grid [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,black,transparent)]" />
      <SiteHeader links={NAV_LINKS} />

      <ArticleShell
        title="Transcripts are a credential sink"
        standfirst="npm wanted a one-time password. On the third failed attempt I pasted the token into the chat instead, and it sat there for two days."
        date="September 2026"
      >
        <p>npm wanted a one-time password.</p>
        <p>
          I typed six digits. npm said they were wrong, or expired — it doesn&apos;t distinguish,
          which is its own small cruelty. I generated another set, and by the time I&apos;d pasted
          those the publish had timed out. On the third go I stopped fighting it and pasted the token
          into the chat instead, and told the agent to use that.
        </p>
        <p>
          It published the package. Then it published the second one. Then it carried on with the
          rest of the afternoon&apos;s work, and the token sat there in the conversation for two more
          days before I remembered to go and revoke it.
        </p>
        <p>
          Nothing came of it. Nobody found it, nothing got compromised, and this isn&apos;t a war
          story. I&apos;m writing it down because of how completely reasonable the decision felt at
          the time, and because I was — that same week, in that same repository — building a tool
          whose entire purpose is stopping people from doing that.
        </p>

        <H2>The part I keep coming back to</H2>
        <p>
          I&apos;ve leaked credentials in most of the usual ways. Committed an <Code>.env</Code>{" "}
          once. Left a key in a Slack thread. Both were embarrassing and both were fixable in about
          ten minutes, because we&apos;ve spent twenty years building the fixes.
        </p>
        <p>
          Push protection catches the commit before it lands. <Code>git filter-repo</Code> and a
          force-push handle it if it does. Logs have redaction filters and retention windows. CI
          masks secrets in output. GitHub will email you if it finds your AWS key on a public repo.
          None of this is perfect but it&apos;s <em>there</em>, and it&apos;s mostly automatic.
        </p>
        <p>There is nothing like that for a conversation.</p>
        <p>
          You can&apos;t rewrite it, because you don&apos;t own the storage and there&apos;s no
          operation that reaches in and removes a string. You can&apos;t age it out, because the
          retention policy isn&apos;t yours either. Nothing scans it. Nothing warns you.
        </p>
        <p>
          And it doesn&apos;t sit still. This is the part I underestimated: a transcript gets re-read
          constantly. Every turn feeds it back through. Resuming a session pulls it up again. Long
          sessions get summarised into new contexts that carry pieces forward. Then there&apos;s the
          ordinary human traffic — you screenshot a bit of it for a bug report, paste a chunk into
          another chat to ask why something failed, forward it to someone who&apos;s better at
          Terraform than you are.
        </p>
        <p>
          One paste, read back an unknowable number of times, in an unknowable number of places.
        </p>

        <H2>&ldquo;Just don&apos;t paste secrets into the chat&rdquo;</H2>
        <p>Sure. I know.</p>
        <p>
          But look at what I was actually doing. I was three OTP attempts into a publish that should
          have taken thirty seconds, in the middle of a longer piece of work, and the token was
          sitting right there in my password manager. The rule wasn&apos;t competing with laziness.
          It was competing with a broken 2FA flow at the exact moment I&apos;d stopped caring about
          anything except getting the package out.
        </p>
        <p>
          Agents publish things, run migrations, hit production APIs, deploy. Those jobs need
          credentials, and the only way we&apos;ve offered to supply one is to hand over the string.
          So the rule gets broken — not by people who don&apos;t know better, but by people who know
          better and are busy.
        </p>
        <Pull>
          If your control only works when someone is paying attention, you don&apos;t have a control.
          You have a preference.
        </Pull>

        <H2>What I actually wanted</H2>
        <p>
          The thing I was trying to give that agent wasn&apos;t a token. It was the ability to
          publish a package. Those aren&apos;t the same, they&apos;re just usually delivered
          together.
        </p>
        <p>So: give it a name for the credential instead of the credential.</p>

        <div className="!my-8">
          <TerminalWindow title=".env — safe to commit, safe to paste, safe to screenshot">
            <Line>NPM_TOKEN=sec://aws/npm/ci#token</Line>
            <div className="h-4" />
            <Prompt>secrefs run -- npm publish</Prompt>
            <Line dim>secrefs: resolved 1 secret reference(s): NPM_TOKEN</Line>
            <Line>+ @acme/widget@1.4.2</Line>
          </TerminalWindow>
        </div>

        <p>
          The reference gets resolved at the moment of use, from a vault that decides independently
          whether the machine asking is allowed to have it. The child process gets a real token. The
          transcript, the <Code>.env</Code>, and my shell history get a string that&apos;s worth
          nothing to anyone who can&apos;t already authenticate to my AWS account.
        </p>
        <p>Same publish. Nothing durable left behind.</p>

        <H2>Where this stops working</H2>
        <p>
          It moves the credential rather than removing it. Something still has to authorize that
          fetch — usually the machine&apos;s own cloud credentials. What changes is the shape of the
          exposure: instead of a long-lived token in a document I can&apos;t purge, there&apos;s a
          short-lived credential scoped by an identity provider I already run and already rotate.
          Better. Not zero. <Strong>If you were hoping for zero, I don&apos;t have it.</Strong>
        </p>
        <p>
          If the agent decides to print the resolved value, it&apos;s back in the transcript and
          we&apos;ve achieved nothing. This closes the path secrets actually escape through — config
          files, environment setup, the pasted-in-a-hurry token — not deliberate output.
        </p>
        <p>
          And anything with code execution on my laptop can read the value out of memory just as
          easily as it could have read it out of <Code>.env</Code>. The threat here is the record,
          not the machine.
        </p>

        <H2>Why bother</H2>
        <p>
          Most of the security conversation around agents right now is about what they&apos;re
          allowed to <em>do</em>. Permissions, sandboxes, approval prompts, tool allowlists. All
          reasonable. But there&apos;s very little about what they&apos;re allowed to <em>know</em>,
          and almost nothing about what happens to that knowledge after the task is finished.
        </p>
        <p>
          The second problem is the easier one. It mostly needs the tooling to stop making
          &ldquo;paste the live secret&rdquo; the fastest path.
        </p>
        <p>I&apos;d have taken that option on the third OTP failure. I&apos;d have taken it happily.</p>

        <div className="!mt-14 rounded-xl border border-white/10 bg-white/[0.02] p-6 text-[0.95rem] leading-relaxed text-slate-400">
          <p>
            <Strong>SecRefs</Strong> is MIT-licensed and reads from the vault you already run — AWS
            Secrets Manager, HashiCorp Vault, or Bitwarden. It stores nothing.
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
