import type React from "react";

/**
 * Long-form reading layout.
 *
 * Deliberately different from the landing pages: those are scanned, this
 * is read. Narrower measure (~68ch), larger body size, more line height,
 * and a serif-free but calmer hierarchy - the marketing pages can shout,
 * an article that shouts is exhausting by the third section.
 */
export function ArticleShell({
  title,
  standfirst,
  date,
  children,
}: {
  title: string;
  standfirst: string;
  date: string;
  children: React.ReactNode;
}) {
  return (
    <article className="relative z-10 mx-auto max-w-2xl px-6 pb-24 pt-16 sm:pt-20">
      <header className="mb-12">
        <a
          href="/articles"
          className="font-mono text-xs uppercase tracking-[0.16em] text-signal-400 hover:text-signal-300"
        >
          Articles
        </a>
        <h1 className="glow-text mt-5 text-balance text-3xl font-bold leading-[1.15] tracking-tight text-white sm:text-4xl">
          {title}
        </h1>
        <p className="mt-5 text-lg leading-relaxed text-slate-400">{standfirst}</p>
        <p className="mt-6 border-t border-white/5 pt-5 font-mono text-xs text-slate-600">{date}</p>
      </header>
      <div className="space-y-6 text-[1.0625rem] leading-[1.75] text-slate-300">{children}</div>
    </article>
  );
}

export function H2({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="!mt-14 text-balance text-2xl font-bold leading-tight tracking-tight text-white">
      {children}
    </h2>
  );
}

/** Emphasised inline text. `<strong>` rather than colour alone, so the
 * emphasis survives for anyone who can't distinguish it. */
export function Strong({ children }: { children: React.ReactNode }) {
  return <strong className="font-semibold text-white">{children}</strong>;
}

export function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded bg-white/[0.06] px-1.5 py-0.5 font-mono text-[0.9em] text-signal-400">
      {children}
    </code>
  );
}

/** A pull-quote for the line the piece turns on. One per article - if
 * everything is emphasised, nothing is. */
export function Pull({ children }: { children: React.ReactNode }) {
  return (
    <p className="!my-10 border-l-2 border-signal-500/50 pl-6 text-xl font-semibold leading-snug text-white">
      {children}
    </p>
  );
}
