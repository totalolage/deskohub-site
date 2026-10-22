import type { StaticLocalizedPageRoute } from "@/features/i18n";

type LocalizedPagePathname<Route> = Route extends `/[locale]${infer Pathname}`
  ? Pathname
  : never;

/** Release gate that decides whether production serves a gated page. */
export type PublicPageReleaseGate = "meeting-room-page" | "office-page";

export interface PublicPage {
  /** Unprefixed pathname, served under every locale prefix. */
  readonly pathname: "/" | LocalizedPagePathname<StaticLocalizedPageRoute>;
  /** Present when the page returns not found while its gate is off. */
  readonly releaseGate?: PublicPageReleaseGate;
}

/**
 * Every public, indexable page. Typecheck proves every page exists; a page
 * here must not set `robots.index` to false. Discovery surfaces list only
 * the published subset from `PublishedPublicPagesService`, so a gated page
 * appears only while production serves it.
 */
export const publicPages = [
  { pathname: "/" },
  { pathname: "/contact" },
  { pathname: "/faq" },
  { pathname: "/ai-assistants" },
  { pathname: "/pricing" },
  { pathname: "/meeting-room", releaseGate: "meeting-room-page" },
  { pathname: "/team" },
  { pathname: "/ttrpg-room" },
  { pathname: "/logo" },
  { pathname: "/terms-and-conditions" },
  { pathname: "/privacy-policy" },
  { pathname: "/cookie-policy" },
  { pathname: "/operating-rules" },
  { pathname: "/marketing-communications" },
  { pathname: "/reservation/cowork" },
  { pathname: "/reservation/meeting-room" },
  { pathname: "/reservation/office", releaseGate: "office-page" },
] as const satisfies ReadonlyArray<PublicPage>;

/** A page of the registry, with its exact pathname. */
export type RegisteredPublicPage = (typeof publicPages)[number];

export type PublicPagePathname = RegisteredPublicPage["pathname"];

const publicPagePathnames: ReadonlySet<string> = new Set(
  publicPages.map(({ pathname }) => pathname)
);

export const isPublicPagePathname = (
  pathname: string
): pathname is PublicPagePathname => publicPagePathnames.has(pathname);
