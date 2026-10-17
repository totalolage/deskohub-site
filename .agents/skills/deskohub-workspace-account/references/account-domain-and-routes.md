# Account domain and routes

## Customer resolution

- `CustomerAccountResolver` is the replaceable identity-to-customer capability
  for authenticated route composition and provider-independent tests.
  `resolveCurrentCustomerAccount` is its Live-wired page convenience. Both
  return only `CustomerAccountId` and `DotyposCustomerId`; the convenience
  adds `autoLinked`, true only when this resolution claimed the link to an
  existing exact-email customer, which the account page uses to record a
  remembered referral. Keep other callers on `resolve`.
- Require the authoritative current session and a verified email, then resolve
  in this order:
  1. An existing durable link wins.
  2. One unique active exact-email Dotypos profile gets linked.
  3. One unique expired profile is reactivated first and only then claimed, so
     a failed reactivation leaves the link unreserved and retryable.
  4. No match requires profile completion; create the Dotypos profile only
     after the customer completes it.
  5. Ambiguous, deleted, unusable, or already-claimed profiles return the
     common support state.
- Claim links through database uniqueness and conflict rereads, so same-account
  races converge and a customer claimed by another account is rejected. Only
  the call that inserted a link reports `created`. A signup referral passed to
  the claim is written in the link's transaction (referrals skill).
- Never create a Dotypos customer from auth data alone; it needs the profile
  completion input.

## Durable customer account

The domain skill's [reservation parties](../../deskohub-workspace-domain/references/reservation-parties.md)
glossary defines the customer account, reservation author, and tombstone.

- `public.customer_accounts` stores the account's id, which is the Better Auth
  user id (`CustomerAccountId`), its creation instant, and `deleted_at`. It has
  no foreign key to `auth.user`, so it outlives the identity, and it holds no
  personal data. While the identity exists, `customer_account_links` links the
  account to its own Dotypos customer.
- The row appears lazily: `ensureCustomerAccount` creates it in the
  transaction that first writes a record naming the account, and deletion
  creates it as a tombstone when the account never authored anything. Eager
  creation, an `auth.user` foreign key, and folding in
  `customer_account_links` come with the contract migration (#682).
- `workspace_reservations.author_account_id` references it with `ON DELETE
  RESTRICT`. Never delete a customer account row; deletion tombstones it
  through `CustomerAccountRepository.tombstone`.
- `OptionalAccountActivityGuard.guardStateCreation` hands the state-creating
  section the account it verified under the account lock, or null for an
  anonymous session. The submission section records it as the author of new
  drafts and calls `WorkspaceReservationRepository.assignAuthor` when a
  signed-in submission reuses an authorless draft. Payment does not set an
  author. An authorless legacy reservation stays authorless until the #682
  backfill.
- `author_account_id` is null only for guest checkouts and for reservations
  made before authors were recorded, until the legacy backfill fills them and
  the column becomes NOT NULL.

## Error contract

- `CustomerAccountAccessError.reason` is closed: `not-configured`,
  `unauthenticated`, `unverified-email`, `link-required`, `unavailable`.
- Attach only fixed non-PII internal failure codes, so operators can tell auth,
  link reads, Dotypos lookup, claims, locks, and deletion apart. Never keep a
  raw provider or database failure as the error cause.

## Routes and pages

- `app/api/auth/[...all]/route.ts` forwards GET and POST to `auth.handler` and
  forces `Cache-Control: private, no-store`.
- Render account and auth pages dynamically.
- Each account section has its own path, `/account/<section>`, with the slugs
  of `features/account/sections.ts`. The bare `/account` shows the default
  section (Reservations) without a redirect, because sign-in returns and the
  header land there. The `account/(sections)` route group serves the bare path
  and `[section]`: its layout renders the account page, every section, through
  `AccountSections`, and its pages render only their metadata and, for
  `[section]`, `AccountSectionPathCheck`, under which an unknown slug or a
  section withheld by its release flag is not found. Legal & Privacy is the
  separate public `/account/legal` page.
- The layout renders beside the page, not under it, so the page's not-found
  cannot stop it: a signed-out account page redirects to sign-in, and that
  redirect would win. `AccountSections` therefore runs the same section check
  first, on the requested path, before it loads the account. A layout gets no
  child params, so the proxy hands every `/account` render, Server Action
  posts included, its pathname (`withRequestPathname`), which
  `getRequestPathname` reads; a render without one is not found. The page's
  own check still covers client navigations, which skip the shared layout.
- Keep the account page in that layout, never in a page. The navigation
  switches sections with `history.replaceState`, which leaves Next's router
  tree on the path the page loaded at; a Server Action that revalidates, or
  `router.refresh()`, then renders the switched path's route, and Next
  remounts whatever differs between the two routes' trees. Only the pages
  differ, so open dialogs and drafts survive; the legal continuity fixture
  covers this from `/account` and from a section's path. Don't serve section paths
  through a proxy rewrite either: the account shell is server-rendered with
  the rewritten pathname and hydrates with a mismatch.
- The account layout's `@modal` slot owns only the intercepted
  `(..)reservation/{status,access}/[orderId]` modals. `@modal/page.tsx` renders
  nothing at `/account`, `@modal/[section]/page.tsx` nothing at a section's
  path (and at `/account/legal` and `/account/deleted`), and
  `@modal/default.tsx` nothing wherever no slot page matches.
  Keep the `[section]` slot page: without it the slot falls back to its
  default at section paths, and a revalidating Server Action after an
  in-place switch from `/account` returns a slot tree the router cannot patch
  onto the bare path's, so it reloads the page and closes open dialogs.
  Don't add a catch-all slot page. If a modal ever links to another account
  route, add an explicit null slot page for that route.
- Every route into `/account/legal` and `/account/deleted` starts with the
  modal closed. The dialog makes the background inert, closing it goes back to
  `/account`, and deletion leaves through a document navigation.
- Build account, section, and sign-in URLs with `features/account/routes.ts`.
  Its helpers pass Next's generated `/[locale]/...` route patterns to
  `getLocalizedPagePath` or, for `[section]`, `getLocalizedDynamicPagePath`, so
  typecheck proves the pages exist (the app doesn't enable `typedRoutes`).
- Sign-in continues to `?returnTo=` (`signInReturnParam`) instead of the
  account when it is a same-origin path; `getAccountSignInPath(locale,
  returnTo)` adds it. The sign-in page passes it into the magic-link callback
  URL, and every exit (link tab, original-tab hand-off, sign-in code, failed-link
  retry) goes through `getSignInDestination`. Validate it with
  `parseSameOriginPath` wherever it is read, because anyone can craft the URL,
  and navigate to its normalized result rather than the raw value (dot
  segments can turn `/x/..//evil.example` into `//evil.example`). Cover each
  new reader with `unsafeReturnTargets`
  (`shared/testing/unsafe-return-targets.test-utils.ts`).
- Retired `/account?section=<section>` links still work: the proxy redirects
  them (307) to the section's path, keeping other query parameters, or to
  `/account` for an unknown section. Never produce a `?section=` URL.
- The header account button links to sign-in for anonymous visitors and to
  `/account` for signed-in customers. Its href is an uncached
  `isCustomerSignedIn` promise that the header resolves with `use()` inside
  `Suspense`, with the sign-in href as fallback. Keep the static shell
  independent of the session; a failed session check reads as signed out.
- Keep sign-in and sign-out as document navigations so the header re-reads the
  session. The `/account` client redirect stays only for direct or stale
  navigations.
- Use one magic-link form for sign-in and implicit sign-up.
- Section navigation items are links to the section paths, marked with
  `aria-current="page"`; disabled items stay buttons. A plain click on the
  signed-in account page switches the already rendered section in place and
  moves the URL with `history.replaceState`, so a reload, a shared link, or a
  locale switch reopens it without a server round trip. Replace, not push:
  the unsaved-changes guard questions every Back traversal, although a section
  switch keeps all drafts. Moving to or from `/account/legal` is a router
  navigation behind the guard. Modified clicks stay the browser's.
- The page metadata keeps the title of the section the page loaded at, even
  after an in-place switch or a Back to a switched path. `AccountLayoutShell`
  sets `document.title` from the path's section with `getAccountPageTitle`
  (`features/account/page-title.ts`), the same helper the metadata uses, so
  the title always matches what a reload would show. The bare `/account` keeps
  the generic account title. After a switch the path always names a section,
  Reservations included.
- Pass a section withheld by a release flag (Referrals behind `referrals`,
  Sign-in & security behind `login_passkeys`) to `AccountShell` as
  `hiddenSections`: it leaves both navigations, and its path is not found. The
  static loading skeleton renders before any flag is known, so it never shows a
  flagged section.

## Profile

- Profile completion and edits update Dotypos (first name, last name, phone,
  billing), never the auth user. Better Auth's `/update-user` path is disabled,
  and the auth guard rejects `name` or `image` in a magic-link request.
- The verified login email is immutable because it's the reservation-linking
  trust boundary. Profile input never accepts an email.

## Deletion

Better Auth's public delete endpoint is the only identity-deletion path:

1. The UI requires explicit destructive confirmation.
2. The endpoint's `beforeDelete` hook calls
   `CustomerAccountDeletionService.requestDeletion`, which takes the account
   lock and then:
   1. persists the `deletionRequestedAt` marker in its own transaction;
   2. expires the linked Dotypos profile with a fresh ETag, retrying once on
      a conflict; a missing or deleted profile counts as done;
   3. destroys the avatar (see [avatar media storage](avatar-media-storage.md));
   4. tombstones the durable customer account (`deleted_at`), last, so
      reservations it authored keep their author. A retry keeps the first
      deletion instant.
3. Any retryable provider failure throws before Better Auth removes the
   identity rows, so deletion stays retryable. The link row goes by cascade;
   the customer account row stays.

The marker blocks profile, reservation, checkout, and resolver activity but
still allows reauthentication, logout, and delete retry. Resolution, profile
edits, and deletion each re-read authority inside the lock. Never delete
retained Dotypos reservations, payments, invoices, or legal evidence.
