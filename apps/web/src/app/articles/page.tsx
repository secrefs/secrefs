import type { Metadata } from "next";
import { ArrowRight } from "lucide-react";
import SiteHeader from "@/components/SiteHeader";
import { NAV_LINKS } from "@/lib/nav";

export const metadata: Metadata = {
  title: "Articles - SecRefs",
  description: "Writing about secret handling, agents, and the places credentials end up.",
};

const ARTICLES = [
  {
    slug: "transcripts-are-a-credential-sink",
    title: "Transcripts are a credential sink",
    standfirst:
      "npm wanted a one-time password. On the third failed attempt I pasted the token into the chat instead, and it sat there for two days.",
    date: "September 2026",
  },
];

export default function ArticlesIndex() {
  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden">
      <div className="pointer-events-none absolute inset-0 bg-grid bg-grid [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,black,transparent)]" />
      <SiteHeader links={NAV_LINKS} />

      <section className="relative z-10 mx-auto w-full max-w-3xl flex-1 px-6 pb-16 pt-20">
        <h1 className="text-balance text-4xl font-bold tracking-tight text-white">Articles</h1>
        <p className="mt-4 max-w-xl text-slate-400">
          Writing about secret handling, agents, and the places credentials end up.
        </p>

        <ul className="mt-12 divide-y divide-white/5 border-y border-white/5">
          {ARTICLES.map((article) => (
            <li key={article.slug}>
              <a
                href={`/articles/${article.slug}`}
                className="group block py-7 transition hover:bg-white/[0.015]"
              >
                <p className="font-mono text-xs text-slate-600">{article.date}</p>
                <h2 className="mt-2 text-balance text-xl font-semibold text-white group-hover:text-signal-400">
                  {article.title}
                </h2>
                <p className="mt-2 max-w-xl leading-relaxed text-slate-400">{article.standfirst}</p>
                <span className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-signal-400">
                  Read
                  <ArrowRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" />
                </span>
              </a>
            </li>
          ))}
        </ul>
      </section>

      <footer className="relative z-10 mt-auto border-t border-white/5">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 py-10 text-sm text-slate-500 sm:flex-row">
          <a href="/" className="font-mono text-slate-400 hover:text-white">
            secrefs.com
          </a>
          <div className="flex flex-wrap justify-center gap-6">
            <a href="https://docs.secrefs.com" className="hover:text-white">
              Docs
            </a>
            <a href="https://github.com/secrefs/secrefs" className="hover:text-white">
              GitHub
            </a>
            <span>Apache-2.0</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
