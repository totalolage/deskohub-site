import type { StaticLocalizedPageRoute } from "./routing";

type LocalizedPagePathname<Route> = Route extends `/[locale]${infer Pathname}`
  ? Pathname
  : never;

/**
 * Public, indexable pages served under every locale prefix, as unprefixed
 * pathnames. The sitemap lists each page once per locale. Typecheck proves
 * every page exists; a page here must not set `robots.index` to false.
 */
export const publicPagePathnames: ReadonlyArray<
  "/" | LocalizedPagePathname<StaticLocalizedPageRoute>
> = [
  "/",
  "/contact",
  "/faq",
  "/meeting-room",
  "/team",
  "/ttrpg-room",
  "/logo",
  "/terms-and-conditions",
  "/privacy-policy",
  "/cookie-policy",
  "/operating-rules",
  "/marketing-communications",
  "/reservation/cowork",
  "/reservation/meeting-room",
  "/reservation/office",
];
