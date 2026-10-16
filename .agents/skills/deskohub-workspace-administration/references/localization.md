# Administration localization

The administration serves `en-US` and `cs-CZ` under the locale segment: `app/[locale]/admin` answers `/<locale>/admin/...`. It follows the customer locale chain (saved preference, URL, cookie, Accept-Language, default) and has the same language switcher, which saves a signed-in customer account's preference.

## Routes and the proxy

- `proxy.ts` treats every path whose first or second decoded segment is `admin` as administration, however it's spelled. A page load without a Better Auth session cookie goes to `/<locale>/auth/sign-in?returnTo=<path>`; the cookie check only saves a render, and the page and action guards are the real gate (see [dashboard.md](dashboard.md)). Server Actions pass straight through to their guard. Otherwise an unprefixed `/admin/...` URL redirects to the resolved locale and keeps its query, so bookmarks, emailed links, and the `dhw auth` URL keep working. Every administration response is `private, no-store` and varies on `Cookie`.
- Customer providers (GTM, PostHog, cookie consent, referral remembrance, unsaved-changes guard) live in `app/[locale]/(site)/layout.tsx`. The administration sits beside `(site)` and gets only the root `<html>`, so it never loads them. Put new customer routes inside `(site)`.

## Paths in code

- Write administration paths unprefixed (`/admin/reservations/${id}`). `AdministrationLink` and `AdministrationRecordLink` add the route locale themselves.
- For any other in-app use, place the path with `localizeAdministrationHref(path, locale)` (`features/administration/administration-href.ts`): form `action`s, `router.push`, plain `<a>` to route handlers such as the invoice PDF. Client components take `locale` from `useRouteLocale()`, server components from `getRequestLocale()`, and Server Actions from `resolveActionLocale()`.
- `useRouteLocale()` (`features/i18n/route-locale.tsx`) reads the locale the root layout provides. Don't read it from `useParams()` or `usePathname()`: on a dynamic route those are request data, and a client component reading them outside Suspense fails the prerender. The compile-only build check doesn't prerender, so only a full build (the Vercel preview) catches it.
- Revalidate an administration page with `revalidateLocalizedPath(path)` (`features/i18n/server/revalidate-localized-path.ts`). A mutation doesn't know which locale's copy is cached, so it revalidates both.
- Keep a URL unprefixed when it leaves the app, such as the `dhw auth` approval URL or a link in the administration API contract. The proxy opens it in the operator's language.
- Administration pages and layouts stay synchronous (`no-blocking-administration-routes`). A synchronous page that only redirects may redirect to the unprefixed path and let the proxy place it.

## Messages

Administration copy has its own Inlang project, `features/administration/i18n/project.inlang`, compiled by `i18n:compile:administration` (which `i18n:compile` depends on) into the ignored `features/administration/i18n/paraglide`. Import it as `m` from `@/features/administration/i18n`, never from `@/features/i18n`, and pass `{ locale }` at each call, as customer copy does. Customer-facing content inside the administration, such as email previews or product names, keeps the customer `m`.

Only a separate project keeps this copy out of customer bundles. Every client-used customer message lands in one chunk that all routes load, and administration messages compiled into the customer project leaked into it through `m`, a separate barrel, Turbopack clusters, and with chunk merging off. A single customer import of one administration message pulls the whole administration catalog into customer chunks.

### Catalogs

- Each area has its own catalog pair, `messages/<area>/{en-US,cs-CZ}.json`, named after the feature directory that owns the screens: `shell` (`admin-shell.tsx`, breadcrumbs, switcher), `administration` (overview, reservations, customers, bookings, orders, operations), `discounts` (codes, vouchers, sales, customer codes), `accounting` (invoices), `access-codes`, `email-campaigns` (campaigns, audiences), `admin-cli` (CLI sessions and approval), and `administrators` (`features/administrators/admin`, the administrator roster). Parallel work on different areas then never edits the same file.
- Prefix every key with its area in camelCase (`administrationReservationListTitle`, `discountsCodeFormSubmit`, `emailCampaignsSendConfirm`). Keys must be unique across all catalogs. Don't put shared words in a common catalog; each area owns its own copy even when the words repeat.
- A new area adds its folder and a `pathPattern` entry in `project.inlang/settings.json`.
- Write full sentences in both locales. Czech copy follows the customer catalog (`features/i18n/messages/cs-CZ.json`) for terms such as rezervace, poukaz, faktura, and přístupový kód; operator copy addresses the reader formally (vy).

## Build-output check

`features/administration/i18n/administration-messages.build.test.ts` reads a production build. It fails if any administration message text appears in a chunk a customer route loads, and also if administration chunks contain no administration text in either locale or customer chunks no customer text, so a broken build or matcher can't pass. It matches message text, not names, because Turbopack renames modules. It guards multi-word or 12-character texts that the customer catalog doesn't share. Shorter single words could be coincidental literals.

The `*.build.test.ts` pattern is excluded from the Workspace `test` script and runs by path:

```bash
bun turbo run build --filter=deskohub-workspace -- --experimental-build-mode=compile
bun --cwd apps/deskohub-workspace run test:build-output
```

Compile mode writes every client chunk without prerendering and needs no environment. CI runs the same steps in the `validate-administration-messages` job, which `test-functional` requires. A failure names the text, chunk, and customer routes. Find the customer client module that imports `@/features/administration/i18n` (directly or through a shared component) and move the copy or the component back into the administration.
