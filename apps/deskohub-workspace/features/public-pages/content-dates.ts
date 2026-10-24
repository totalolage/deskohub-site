import type { PublicPagePathname } from "./public-pages";

/**
 * The day each public page's content last changed, which the sitemap
 * publishes as `lastmod`. Search engines trust `lastmod` only while it tracks
 * real changes, so move a page's date in the change that alters what the page
 * shows, and never to a deploy or build time. A legal page's date is its
 * document's "last updated" date.
 */
export const publicPageContentDates = {
  "/": "2026-10-21",
  "/contact": "2026-10-19",
  "/faq": "2026-10-21",
  "/ai-assistants": "2026-10-22",
  "/pricing": "2026-10-19",
  "/meeting-room": "2026-10-21",
  "/team": "2026-10-19",
  "/ttrpg-room": "2026-10-21",
  "/logo": "2026-10-17",
  "/terms-and-conditions": "2026-08-12",
  "/privacy-policy": "2026-10-21",
  "/cookie-policy": "2026-10-13",
  "/operating-rules": "2026-08-12",
  "/marketing-communications": "2026-08-05",
  "/reservation/cowork": "2026-10-21",
  "/reservation/meeting-room": "2026-10-16",
  "/reservation/office": "2026-10-22",
} as const satisfies Record<PublicPagePathname, string>;
