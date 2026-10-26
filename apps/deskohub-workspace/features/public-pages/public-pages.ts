import type { StaticLocalizedPageRoute } from "@/features/i18n";

// The proxy imports this module, so it names only pathnames and stays clear
// of the message catalogs. `public-page-definitions.ts` describes each page.

type LocalizedPagePathname<Route> = Route extends `/[locale]${infer Pathname}`
  ? Pathname
  : never;

/**
 * Every public, indexable page by its unprefixed pathname, served under
 * every locale prefix, in the order discovery surfaces list them. Typecheck
 * proves every page exists.
 */
export const publicPagePathnames = [
  "/",
  "/coworking",
  "/contact",
  "/faq",
  "/ai-assistants",
  "/pricing",
  "/meeting-room",
  "/team",
  "/gallery",
  "/ttrpg-room",
  "/terms-and-conditions",
  "/privacy-policy",
  "/cookie-policy",
  "/operating-rules",
  "/marketing-communications",
  "/reservation/cowork",
  "/reservation/meeting-room",
  "/reservation/office",
] as const satisfies ReadonlyArray<
  "/" | LocalizedPagePathname<StaticLocalizedPageRoute>
>;

export type PublicPagePathname = (typeof publicPagePathnames)[number];

const publicPagePathnameSet: ReadonlySet<string> = new Set(publicPagePathnames);

export const isPublicPagePathname = (
  pathname: string
): pathname is PublicPagePathname => publicPagePathnameSet.has(pathname);
