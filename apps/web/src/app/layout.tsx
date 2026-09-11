import type { Metadata } from "next";
import Script from "next/script";
import "./globals.css";

export const metadata: Metadata = {
  title: "SecRefs - Bring Your Own Vault secret reference engine",
  description:
    "SecRefs expands sec:// secret references in memory at runtime. No plaintext ever hits disk, no third-party SaaS vault required.",
  metadataBase: new URL("https://secrefs.com"),
  openGraph: {
    title: "SecRefs - Bring Your Own Vault",
    description:
      "Decouple secret storage from your application. sec:// references expand in memory, at runtime, from whatever vault you already run.",
    url: "https://secrefs.com",
    siteName: "SecRefs",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "SecRefs - Bring Your Own Vault",
    description: "Decouple secret storage from your application with sec:// references.",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="bg-ink-950 font-sans text-slate-200 antialiased">
        {children}
        {/* Rybbit: cookieless, no cross-site identifiers, so there is
            nothing here to consent to and no banner to show. next/script
            with afterInteractive rather than a raw tag - React will not
            reliably keep a hand-written <script> through hydration. */}
        <Script
          src="https://app.rybbit.io/api/script.js?siteId=379a27a851a2"
          strategy="afterInteractive"
        />
      </body>
    </html>
  );
}
