import type { NavLink } from "@/components/MobileNav";

/**
 * The one nav, used by every page.
 *
 * Previously each page declared its own array and they drifted into five
 * different navs — the homepage had eight items, /articles had four, and
 * none of them agreed on the order.
 *
 * Site destinations only, no in-page anchors. An anchor like
 * `/#how-it-works` behaves completely differently depending on which page
 * you're on: a scroll on the homepage, a full navigation anywhere else.
 * Mixing the two in one bar means half the links do something different
 * than the other half, which is exactly the kind of thing nobody can
 * articulate but everybody feels.
 *
 * The homepage's own sections are reachable by scrolling and from the
 * hero buttons, which is what they're for.
 */
export const NAV_LINKS: NavLink[] = [
  { href: "/agents", label: "For agents" },
  { href: "/for-vendors", label: "For vendors" },
  { href: "/articles", label: "Articles" },
  { href: "https://docs.secrefs.com", label: "Docs" },
];
