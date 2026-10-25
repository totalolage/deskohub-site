---
name: deskohub-workspace-public-site
description: Workspace public site SEO, locale fallback, default locale, Accept-Language, locale prefix redirect, x-default, hreflang, canonical, noindex, X-Robots-Tag, sitemap lastmod, page content dates, vercel.app alias, canonical host, unmatched URL 404, not-found page, proxy matcher, root files.
---

# Deskohub Workspace public site

## Locale routing

- `resolveWorkspaceLocale` (`features/i18n/locale-resolution.ts`) ends in a fallback that `localeConfig` (`features/i18n/routing.ts`) names: Czech when the request states no language (crawlers usually send no `Accept-Language`), English when it names only languages the site doesn't serve. Slovak maps to Czech. Paraglide's `baseLocale` and `defaultLocale` stay `en-US`: they drive message fallback and non-request defaults such as agent tools, not visitor negotiation.
- A locale prefix in another letter case (`/en-us`) or a bare language from `preferredLanguageToLocale` (`/en`, `/sk`) gets a 308 to the exact locale, decided by the URL alone (`findExactLocalePathname` in `@deskohub/i18n/pathname`). Any other unprefixed path gets the negotiated locale with a 307 and `Vary: Accept-Language`.
- Internal links stay locale-agnostic (`getPagePath`, `getWorkspacePageUrl`). Canonical, hreflang and sitemap URLs name the exact locale page (`getWorkspaceAlternates`). `x-default` is the locale-agnostic URL, so it follows negotiation and opens Czech for crawlers.

## Hosts and root files

- In production the proxy 308s page loads on any host other than the canonical origin (the `*.vercel.app` aliases) to the canonical origin. Preview deployments keep their own hosts. `/api` and dotted paths skip the proxy, so crons, webhooks and queues on deployment URLs keep working.
- The proxy matcher skips every path with a dot. A root file that must not get a locale prefix, such as the company extract (`/official-company-extract.pdf`), keeps a dotted path.
- The proxy runs before files, so it can't tell an unmatched dotted path from a root file. An `afterFiles` rewrite in `next.config.mjs` does: Next applies it after `public/` files and non-dynamic routes but before dynamic routes such as `[locale]`. It sends a dotted path outside the locales, `/api`, `/page-markdown` and the build assets to `app/locale-redirect/[...path]`. That handler gives the path the exact-locale 308 or the negotiated 307, like the proxy, and the localized catch-all then answers 404. So a dotted root file must be a `public/` file or a non-dynamic route. A dynamic route that serves dotted paths outside the locales needs an exclusion in that rewrite; `next.config.test.ts` covers it. Custom routes match regardless of letter case, so the rewrite can't send a dotted path under a wrong-case locale (`/en-us/x.html`) to the exact-locale redirect, and that path keeps the bare 404.
- Machine-readable files (`llms.txt`, `security.txt`, the IndexNow key) mark their responses with `markUnindexedResponse` (`shared/utils/unindexed-response.ts`).

## Indexing

- A noindexed page sets no `alternates` and no `openGraph.url`. `app/[locale]/(site)/page-metadata.test.ts` covers the indexable registry pages and the noindexed transactional pages.
- The sitemap's `lastmod` comes from `publicPageContentDates` (`features/public-pages/content-dates.ts`). When a change alters what a public page shows, move that page's date to the change's day in the same change. Never derive it from a deploy or build time. A legal page's date must match its document's `updatedAt` in both locales; `content-dates.test.ts` checks this.

## Not-found responses

- A `notFound()` that reaches the server-rendered shell (outside every Suspense boundary) makes Next send its bare `<html id="__next_error__">` document, with no `lang`, title or content; the browser then paints the boundary from the RSC payload, so a Playwright check of the visible heading still passes. Check server HTML with a plain HTTP request.
- Without a locale prefix, an unmatched path would reach the `[locale]` layout, whose `notFound()` for an unknown locale gives the bare document. Undotted paths get the proxy's locale redirect, and dotted ones get the `afterFiles` rewrite above.
- Unmatched paths under a locale reach `app/[locale]/(site)/[...not-found]`, which the build prerenders once per locale. Its `generateMetadata` throws `notFound()` without `connection()`, so the prerender carries the 404 status to the edge cache. Its shell renders `NotFoundContent` (`(site)/not-found-content.tsx`, shared with `(site)/not-found.tsx`) as a Suspense fallback, and the page's own `notFound()` streams after the shell. A request-time metadata throw doesn't work: the cached shell answers 200 first.
- A gated page throws `notFound()` in `generateMetadata` as well, so crawlers get a real 404 even when browsers get the streamed boundary (see `deskohub-workspace-feature-flags`).
