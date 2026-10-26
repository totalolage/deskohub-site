---
name: deskohub-react-ui
description: React, TSX, JSX, components, page metadata, generateMetadata, Open Graph, share image, og:locale, Twitter card, shadcn, Tailwind container queries, accessibility, live regions, translated copy, Inlang, Paraglide, m.* messages, locale, React Hook Form, Workspace forms, useWorkspaceAction, memoization, shareable or external links, locale prefix, locale-agnostic page URL, llms.txt links, JSON-LD url, canonical, hreflang, sitemap URL.
---

# Deskohub React UI

For Workspace forms, also read [references/workspace-forms.md](references/workspace-forms.md).

## Components and JSX

- Render a branch with no else case as `{condition && <Component />}`, not a ternary with `null`.
- Map a small variant union to copy, icons, or similar values with an inline object lookup, not ternaries.
- Inline one-use `className` strings, literals, and lookup objects where they're consumed.
- Use the matching shadcn primitive for standard interactions, for example Tooltip for hover and focus hints. Add a missing primitive through the app's `components.json` and adapt only its shared styling and React conventions.
- Build administration list counts and their search or filter controls with `AdministrationTableToolbar` and `AdministrationTableCount` (`features/administration/table-toolbar.tsx`).
- Keep reservation-family-neutral form shells and primitives, including date and date-time pickers, in `features/reservation/components`. Put only family-specific fields and policy UI under `features/cowork` or `features/meeting-room`.
- Lay out content in a variable-width slot, such as beside a sidebar, with Tailwind container queries (`@container` on the slot, `@xl:`-style variants inside). The account content slot in `features/account/components/shell/account-frame.tsx` is the reference. Use viewport breakpoints for page shells and portaled content such as dialogs.

## State and effects

- Model recurring time-driven client state with Effect Atom and Stream, as `features/team/components/use-censored-founder-name.ts` does, not `useEffect` interval state.
- The React Compiler memoizes render-only derivations. Add `useMemo` or `useCallback` only where identity is observable: effect dependencies, inputs to identity-compared hooks, and third-party props such as lightbox `slides` or photo-album `photos`.
- Don't key a component by server state that its own `router.refresh()` changes. The remount drops local feedback and focus. Adjust local state from changed props during render instead.
- `useWorkspaceAction` reports a thrown (transport) action failure as `hasErrored` with no `serverError` and runs `onError` for it. Handle it in `onError`. If you also pass `onTransportError`, the hook skips `onError` for transport-only failures, so put the handling in one place.
- The server already localizes `serverError`, so render `serverError ?? <your transport fallback copy>`. Don't match or translate its text on the client.

## Copy and locale

- Keep customer-facing copy in the owning app's Inlang message catalogs as full sentences in both locale files, consumed with `m.*` in components and email-rendering TSX alike. Long-form legal and GDPR prose stays in its source modules: `features/legal/content.tsx` (Workspace) and `features/gdpr/texts/` (Boardgame Bar).
- Admin interface copy (`/[locale]/admin`, `features/administration`, `features/*/admin`) comes from the administration Inlang project: `m` from `@/features/administration/i18n`, never a customer catalog entry. Customer code must never import it. Customer-facing content shown inside admin screens, such as email previews or catalog product names, keeps the customer `m.*`. Read [administration localization](../deskohub-workspace-administration/references/localization.md) before adding admin copy. Screens not yet migrated still hard-code English.
- Call `m.someMessage({}, { locale })` at each use site. Don't build per-locale copy maps or copy props for injection, and assert real catalog or rendered text in tests.
- When a localized sentence contains links or other components, use `@doist/react-interpolate` and keep the whole sentence in one message.
- Build a shareable or external link (anything copied, shared, or received outside the app, such as a referral share link) as an absolute URL on the origin from `getWorkspaceRuntimeCallbackOrigin`, with no locale prefix, so the proxy opens it in the recipient's language. Display and copy that same URL; in-app navigation keeps the prefix. Links in customer emails are the exception below.
- Reference a site page outside in-app navigation by its locale-agnostic URL (`https://workspace.deskohub.cz/faq`, not `/en-US/faq`): `llms.txt`, the Markdown page variants, JSON-LD links such as `url` and `offers.url`, agent tool results, and anything else agents read. Build it with `getWorkspacePageUrl` (`features/i18n/page-url.ts`) on the production origin, or with an unprefixed path (`getUnprefixedPagePath`, the `features/reservation/routes.ts` paths) on the runtime origin; the proxy 307-redirects it to the visitor's locale and keeps the query. Keep the exact locale page only where the URL must name it:
  - `rel="canonical"`, including a Markdown variant's `Link` header: each locale page canonicalizes to itself ([canonicalization best practices](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls#best-practices)).
  - hreflang alternates, in `<link>` tags and the sitemap: each language version lists itself and the others by their own URLs ([localized versions](https://developers.google.com/search/docs/specialty/international/localized-versions#all-method-guidelines)). `x-default` is the locale-agnostic URL, as Google recommends for auto-redirecting pages.
  - sitemap `<loc>`: Google crawls listed URLs exactly as given, so list the page meant for Search ([build a sitemap](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap#general-guidelines)).
  - locale-bound continuations (`features/checkout/locale-bound-continuation.ts`): the signed Pay URL (`pay_url`) and the reservation pages that restore an edited reservation carry a Pay state bound to the locale it was issued in, which `payStateContinuesOn` rejects on any other locale; an invoice link's access token issues the invoice in the reservation's locale.
  - links in customer emails: they keep the locale the email was written in, so the page opens in the email's language. The locale-agnostic rule covers agent-facing outputs and site references, not emails.
- Build a customer-site page's metadata with `createPublicPageMetadata` (`features/public-pages/page-metadata.ts`). It gives every page the canonical and hreflang URLs, `og:locale` in Open Graph form, and the complete Open Graph and Twitter card with the share image. A page's own `openGraph` replaces the layouts' whole, image included, so never set `openGraph` by hand. A `{ page }` title gets ` | Deskohub Workspace` appended; pass `{ absolute }` only for a title written in full that already names the site.
- Link metadata images and icons from metadata, as `public/` files, imported static assets or route handlers, rather than as static `opengraph-image`, `icon` or `favicon.ico` files in `app/`. Vercel's build adapter failed on a static `app/[locale]/opengraph-image.jpg` (`ENOTDIR … opengraph-image.jpg/route` in `onBuildComplete`, PR #823).
- Format dates for the locale before passing them into messages. Don't hardcode localized dates in message strings.
- Format times of day and date or time ranges with `Intl` on the server, and pass the text or server-rendered elements into client components. Node's ICU separates them with narrow no-break and thin spaces (`U+202F`, `U+2009`) that Chromium replaces with plain spaces, so the same value formatted in a client tree fails hydration (React error #418 with `text`). Plain dates without a time format the same in both. Bun formats like Chromium, so `bun test` can't catch the mismatch. `features/account/components/account-page.tsx` passes the reservation history into `LinkedAccount` this way.
- In Workspace, always pass `{ locale }` during rendering. Paraglide's ambient locale (`getLocale()`, or `m.*()` without a locale) falls back to `en-US` in children React renders after `runWithRequestLocale` returns. Server route files get the locale from `getRequestLocale()` or the callback argument and pass it down. Client route boundaries such as `error.tsx` read it from `useParams()`.
- Pass the visitor's `locale` to `DialogContent` and `SheetContent` in customer-facing UI. Their screen-reader close label defaults to the base locale.

## Accessibility

- Keep `aria-live`, `role="status"`, and `role="alert"` containers mounted and toggle only their content. Screen readers often skip a region inserted together with its text. Don't combine `role="alert"` with `aria-live="polite"`.
- When skeletons show loading, drop redundant visible loading copy but keep an accessible label or announcement.

## Screenshots

A PR that introduces a visible UI state needs screenshot evidence. Follow `deskohub-pr-review`. Use tests, not empty screenshots, for states that render nothing.
