# Account domain and routes

## Customer resolution

- `CurrentCustomerAccount` (`features/account/backend/current-customer-account.ts`)
  reports the current session's standing as facts, and each caller keeps its
  own policy as a small match over it. Read standing through it, never by
  ordering the session, review marker, and resolver reads yourself. Kinds:
  `signed-out`, `unverified`, `deletion-pending`, `review`, `unlinked` (peek
  only), `profile-missing` and `support-required` (resolve only, with
  `ambiguous`, `unusable`, or `claimed`), `linked` (with `autoLinked`), and
  `unavailable` (the session is known but a link, lock, or Dotypos step
  failed, or the locked recheck refused it; `failure` says which, and a
  resolve step that dies reads as `account-link.lock`). Signed-in kinds carry
  the session and `reviewMarker` (`absent` or
  `unreadable`; `deletion-pending` may also carry `present`). Only a failed
  session read fails the Effect (`not-configured`, `unavailable`).
  - Order: session, review marker (an unreadable marker is logged once as
    `account.review.unavailable` and resolution still runs), deletion marker,
    review account, then the link.
  - `peek` reads the stored link only: no claim, reactivation, or Dotypos
    call.
  - `resolve` runs the held steps in a `session` account section, so it
    reuses an enclosing hold of the same account. A recheck under the lock
    that finds the session gone reports `signed-out`; one that finds the
    email unverified or a deletion marker reports `unavailable` with that
    refusal (`unverified` and `deletion-pending` come only from the
    pre-lock read). It writes only the reactivation and the link claim,
    never a signup referral.
  - `requireActive` is the verified session of an account not awaiting
    deletion, or `unauthenticated`, `unverified-email`, or `link-required`
    with `deletion-requested`.
  - Callers map outcomes differently on purpose. The account state
    (`loadAccountState`) shows `unverified` and a failed session read as
    `unavailable`, an `unavailable` whose failure is the recheck's
    `link-required` or `unverified-email` as `support-required` without
    history, and any other `unavailable` as `authenticated-unavailable`.
    Checkout treats `not-configured` and `deletion-pending` as signed out
    and `unverified` as unavailable; after resolving, a session gone or a
    recheck `link-required` is signed out and a recheck `unverified-email`
    is unavailable. Don't merge those mappings into the module.
  - Checkout's existing-customer load (`loadCheckoutAccount` in
    `reservation-existing-customer.server.ts`) peeks first and resolves only
    an `unlinked` account whose marker is `absent`, so a linked account
    loads without the account lock. An `unlinked` account with an
    `unreadable` marker is unavailable there, since it might be a review
    account. Prepare-pay (`resolveAccountCustomer` in
    `reservation-booking.service.ts`) only peeks: it runs inside
    `withOptionalAccount`, after the booking's own review check, and
    completes a missing profile itself. Each booking channel provides
    `CurrentCustomerAccount` with its own authentication.
  - The account state reads it through `AccountStateCapabilities`. When its
    link capabilities can't be built, `accountStateCapabilities` substitutes
    `CurrentCustomerAccount.LinksUnavailable`, so the session's sections
    still load.
  - The table test (`current-customer-account.postgres.test.ts`) covers every
    kind over test Postgres and a Dotypos fake. Page and checkout tests fake
    the standing.
- `CustomerAccountResolver.resolve` is the replaceable identity-to-customer
  capability for the callers that haven't moved to `CurrentCustomerAccount`
  yet. It returns only `CustomerAccountId` and `DotyposCustomerId`.
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
- Profile creation (`CustomerProfileService.create`, in its own `active`
  account section, reused when an enclosing section holds the account) reruns
  the held resolution steps (`resolveHeldCustomerAccountLink`) and creates only on
  `not-found`. Because the created customer carries the verified email, a retry
  after a failed link write links that customer instead of creating another.

## Durable customer account

The domain skill's [reservation parties](../../deskohub-workspace-domain/references/reservation-parties.md)
glossary defines the customer account, reservation author, and tombstone.

- `public.customer_accounts` stores the account's id, which is the Better Auth
  user id (`CustomerAccountId`), its own Dotypos customer
  (`dotypos_customer_id`, unique, null until the profile is completed), its
  creation instant, `deleted_at`, and `legacy`. It holds no personal data.
  `legacy` marks the existing customers #764's backfill gave silent logins;
  they never count as new accounts (see the domain skill's email-campaigns
  reference). Nothing sets it any more, so new rows take the default `false`.
- Every login has one. Better Auth's `user.create.before` hook creates the
  account (`ensureCustomerAccount`) before it inserts the login, and
  `auth.user.id` references `customer_accounts.id` with `ON DELETE RESTRICT`,
  so the account outlives the login. A server-side `createUser` must pass the
  id from `generateId`, and anything that inserts `auth.user` rows directly,
  such as a test fixture, creates the account first.
- Better Auth can't run that hook and the login insert in one transaction
  (its magic-link `createUser` isn't transaction-wrapped), so a failed insert
  leaves an account without a login. The daily auth cleanup cron tombstones
  live accounts whose login is gone once they are a day old
  (`tombstoneOrphanedAccounts`). Account deletion tombstones the account
  before it deletes the login, so the sweep only catches interrupted flows.
- `CustomerAccountLinkRepository.claim` links the account to its customer on
  that row. Only a live account without a customer takes one, the unique index
  turns a customer another account holds into `claimed`, and only the claim
  that records the link writes the `account-created` event and the signup
  referral.
- `workspace_reservations.author_account_id` is `NOT NULL` and references it
  with `ON DELETE RESTRICT`. Never delete a customer account row; deletion
  tombstones it through `CustomerAccountRepository.tombstone`, which also
  clears its Dotypos customer so another account can claim it.
- `CustomerAccountSections.withOptionalAccount` hands the state-creating
  section the account it verified under the account lock. Checkout requires a
  verified session, so the submission section always gets one; it records it
  as the author of new drafts and never reuses a draft another account
  authored. Payment does not set an author.
- `CustomerReservationHistoryService` lists the rows of the account's own
  customer and the rows it authored for other customers (fetched from Dotypos
  by reservation id through `getReservationsByIds`). Each summary's `party` labels the
  other side: `booked-for` for an authored row of another customer,
  `booked-by` or `booked-by-deleted-account` when `isCustomerOwnAuthor` says
  a different account booked the account's own customer. Names come from
  `getCustomerDisplayName` over `getCustomersByIds` reads. Author and
  name reads are degradable: a failure logs a fixed code and leaves the party
  unnamed (null), never failing the history.
- Legacy reservations got their authors before release B (#682): release A's
  `dhw accounts backfill` gave each unlinked legacy customer a silent,
  unverified login for its Dotypos email and linked it without an
  `account-created` event or referral, and B's migration enforces the result.
  Workspace rejects such a login's sessions until its owner signs in by link
  or code to that email, which verifies the same row. Account-created
  reconciliation and campaign audiences count only verified logins. Nothing
  creates unverified logins any more.

## Review accounts

- `customer_accounts.review` marks an app-directory review account; its check forbids a Dotypos customer. `resolveHeldCustomerAccountLink` refuses one (`account.review`) before any Dotypos lookup, so neither resolution nor profile completion links or creates a profile.
- `CurrentCustomerAccount` reports a review account before resolution, and the account page loads the `review-account` state from it: `ReviewAccountCard` replaces profile completion, and the Reservations section shows its sandbox history. The reservation form's `review-account` checkout state books on the account card with `getReviewAccountContact` (synthetic, never stored) and offers no contact entry or consent.
- `CustomerAccountContactService.current` returns that synthetic contact, which is why it returns booking-contact fields without a Dotypos customer.

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
- `loadAccountPageState` (`features/account/page-data.server.ts`) declares
  every capability it reads in its requirements (`AccountPageCapabilities`),
  and `loadCustomerAccountPage` provides them once at the page's single
  runtime edge through `accountPageCapabilities`
  (`features/account/account-page-capabilities.server.ts`). That composition
  replaces a capability whose layer fails to build (Dotypos or Cloudinary
  configuration, or a server module it loads) with an interface-checked
  stand-in whose operations replay the failure as a defect; a step that can
  finish without using its capability starts with `replayBuildFailure(tag)`,
  so it still fails first, as when it provided that layer. A section that may
  fail degrades through `degradable(code, fallback)`, which recovers from any
  cause except interruption and Next.js control flow, so a failed build or a
  dying read degrades that section alone and a skipped section is unaffected.
  Account flags fail closed the same way. Test the loader through
  `accountPageCapabilities` with Layer fakes, never module mocks.
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
- `GET /[locale]/account/invoices/[invoiceId]/pdf` and
  `GET /[locale]/account/invoices/export` (under `(site)/(full-header)`) are
  thin files over `features/account/customer-invoice-download-route.server.ts`,
  which reads `CustomerInvoiceService`. Every refusal (signed out, no linked
  customer, a review account, deletion pending, another customer's, unknown,
  or malformed invoice id, invalid locale) answers the same empty private
  404; a load failure answers a private 500 without document bytes; success
  is a private attachment. Build their URLs with `getAccountInvoicePdfPath`
  and `getAccountInvoiceExportPath` (`features/account/routes.ts`). The page
  streams the list with `loadCustomerInvoiceHistory`
  (`features/account/invoice-history.server.ts`), whose Effect
  `loadInvoiceHistory` never fails: `populated` (server-formatted rows),
  `empty`, `unavailable`, or `failed`. `AccountSections` hands `AccountPage`
  a `loadInvoiceHistory` callback; only a linked or review account's page
  calls it and renders `InvoiceHistoryPanel`
  (`features/account/components/billing/invoice-history.tsx`) as the Billing
  section's own panel below the billing form, never inside the form's panel
  with its sticky Save footer. The panel's title and status region render at
  once; the rows, the CSV export link, and the status text read the history
  with `use` inside their own Suspense boundaries, so the page never waits for
  invoices. Component tests that rerender the page pass an already settled
  history (a promise with `status: "fulfilled"`), because a pending one keeps
  a synchronous `act` rerender from committing. See the checkout skill's
  accounting-documents reference for the invoice rules.
- Every route into `/account/legal` and `/account/deleted` starts with the
  modal closed. The dialog makes the background inert, closing it goes back to
  `/account`, and deletion leaves through a document navigation.
- `/account/legal` shows this device's cookie categories, then, while signed
  in, the account's analytics preference, then the marketing preferences,
  then the account data export for a session its route would serve (see
  [account data export](account-data-export.md#authorization)).
  The page reads the preference with `getAnalyticsPreference`
  (`features/legal/analytics-preference.server.ts`): on when the account's
  current decision is a grant under any privacy notice, off for a withdrawal
  or no decision, and `unavailable` when the ledger or session can't be read.
  `AnalyticsPreferenceRow` renders no switch while unavailable, so a failed
  read never shows as off. The device's analytics switch stays the banner
  choice for this device; the account switch is the decision for every
  device.
- The account switch saves through `saveAccountAnalyticsPreference`
  (`legal.analytics-consent.save-preference`). Off records a `withdraw` with
  source `preference` and requests `AnalyticsPersonAnonymisation
  .anonymiseWithdrawnAccount`, whose failure never reaches the action; on
  records a `grant` under the current privacy notice and makes no PostHog
  call. The action returns the account the decision was recorded for and
  the stored instant, and the row applies it to this device with `visitorConsent.applyAccountDecision` (change
  `preference`): the cookie is dated at that instant, so the hydration mirror
  never records it again, and the banner-save mirror never sees it as a
  `local` save. The analytics session then resets the browser identity on
  off, or re-verifies the account and identifies on on. The switch is
  optimistic and returns to the last saved value when the save fails or the
  session ended; nothing is written to the device then. A device choice
  saved while the save ran (its own analytics switch, another tab), or a
  session no longer signed in to the account the decision was recorded for,
  also leaves the device as it is.
- Other devices take a withdrawal at their next signed-in page load: the
  hydration mirror (`recordSignedInDeviceAnalyticsConsent`) returns the
  account's withdrawal when the device's saved choice accepts analytics and
  the ledger didn't take that choice over it, and
  `AccountAnalyticsConsentMirror` declines analytics on the device, dated at
  the withdrawal, unless the device's choice or the signed-in account
  changed while the request ran. A device choice dated at the withdrawal's
  own instant takes the withdrawal too.
  A grant reaches only devices without a choice, through the silent grant.
- Build account, section, and sign-in URLs with `features/account/routes.ts`.
  Its helpers pass Next's generated `/[locale]/...` route patterns, with any
  `[section]` value, to `getLocalizedPagePath`, so typecheck proves the pages
  exist (the app doesn't enable `typedRoutes`).
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
- The header's Admin entry (button and mobile-menu button) follows
  the same pattern: an uncached `isCurrentAccountAdministrator` promise
  (`features/administrators/server`) checks the verified session's account
  against `AccountRoleGrants` on every request, renders nothing while pending,
  and reads any failure as not an administrator.
- Keep sign-in completion and sign-out as document navigations so the header
  re-reads the session. The `/account` redirect for signed-out visitors stays
  only for direct or stale navigations, and it is a document navigation too,
  so it loads the sign-in page instead of opening its modal.
- A sign-in that finishes in the browser (passkey, link callback or
  hand-off, typed code) calls `completeBrowserSignIn` and leaves with
  `leaveForSignInDestination` (`features/account/browser-sign-in-completion.ts`).
  Never sequence the analytics record, passkey-prompt note, passkey marker or
  pending-request forget at the call site. Tests read those outcomes through
  `browser-sign-in-completion.test-utils.ts` instead of mocking the storage
  modules.
- Use one magic-link form for sign-in and implicit sign-up. Only an
  app-directory review login's address gets a password step after it; see
  the password bullet in [Better Auth configuration](better-auth-configuration.md).
- The site layout's `@modal` slot intercepts `/auth/sign-in` and
  `/auth/verify`: a client navigation, such as the header's sign-in link,
  opens the page as a modal over the current page, and a document load
  renders the full page. `@modal/default.tsx` renders nothing everywhere
  else; don't add a catch-all slot page (see the account slot above). A modal
  closes with `router.back()`.
- The magic-link callback carries the return target base64url-encoded as
  `return` (`getAuthCallbackPath`, read back with `readAuthCallbackReturnTo`),
  not as a plain `returnTo`: Better Auth decodes a magic link's `callbackURL`
  a second time before it redirects, which would split a query nested in the
  target. Checkout return targets carry queries.
- A page that sends the sign-in email itself, such as a checkout form, calls
  `startEmailSignIn({ locale, email, returnTo })` and moves to
  `getAuthVerifyPath`. It fails with `invalid-return-path` rather than send
  an email whose `returnTo` would be dropped. The tab's pending
  request (`email-sign-in-request.ts`) is one external store shared by the
  sign-in card and the verify page and mirrored to sessionStorage; never put
  the email in the URL. The request records whether the email carries a code
  (`login_email_code`), so the verify page shows the code entry or the
  link-only instructions. A review login's address returns `password`
  instead of `sent`, and its request records `method: "password"`: the
  sign-in card, the verify page, and reauthentication show
  `SignInPasswordForm`, which signs in through `signIn.email` against the
  request's callback and continues through it like a code. Callers of
  `startEmailSignIn` move to the verify page on `sent` or `password`. It also records its return target: the sign-in
  card resumes it when opened without one or for the same one, and starts
  a fresh request when opened for another, since the sent link already
  lands on the stored target.
- State that must survive the round trip through the email, such as the
  checkout contact step's typed details (the reservation page's `contact`
  parameter in the checkout skill's `checkout-pages.md`), rides in the return target's query as a token from
  `makeAuthReturnState(purpose, schema)`
  (`features/account/backend/auth-return-state.ts`): sealed with the shared
  sealed-state helper, purpose-bound, compressed, and usable for 30 minutes.
- `?for=` (`signInPurposeParam`) tells the visitor why they sign in. It only
  changes the sign-in card's heading and description; `returnTo` alone
  decides where sign-in continues. The status page redirects a signed-out
  visitor whose reservation would be not found to
  `getAccountSignInPath(locale, statusPath, "reservation")`, which shows
  "Sign in to see your reservation" and returns to the status page. Parse the
  parameter with `parseSignInPurpose`.
- Return targets have a size contract. `parseSameOriginPath` accepts paths up
  to `maxSameOriginPathLength` (8 KiB), so the magic link that carries one
  base64url-encoded stays under Vercel's 14 KB URL limit. An auth return
  token is at most `maxAuthReturnStateLength` (6 KiB) and fails to seal with
  `SealedStateTooLargeError` beyond it, leaving 2 KiB for the page and its other
  parameters. A new sealed schema must fit its largest accepted value;
  extend the boundary test in `auth-return-state.test.ts` with it.
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
- The profile contract rejects a nonblank phone that holds no phone number,
  so a save never clears a phone by accident. A blank phone is the explicit
  clearing. `CustomerProfileInput` is what the form and typed clients send,
  phone as entered text: Effect's `HttpApiClient` takes a payload's decoded
  type, so a payload schema that decoded the phone would make every client
  send E.164. The Workspace reads it as a `CustomerProfileSave`, with the
  phone decoded to its `PhoneNumber`: the profile actions' schemas decode to
  it, and the customer API handlers read the payload into it.

## Deletion

Better Auth's public delete endpoint is the only identity-deletion path:

1. The UI requires explicit destructive confirmation.
2. The endpoint's `beforeDelete` hook calls
   `CustomerAccountDeletionService.requestDeletion`, which runs in an account
   section with the `present` recheck (the account must exist; a marker from
   an earlier attempt is tolerated) and then:
   1. persists the `deletionRequestedAt` marker in its own transaction;
   2. expires the linked Dotypos profile with a fresh ETag, refreshing once
      on a genuine version conflict; a missing profile counts as done, and an
      uncertain expiration fails so deletion stays retryable;
   3. destroys the avatar (see [avatar media storage](avatar-media-storage.md));
   4. tombstones the durable customer account (`deleted_at`), last, so
      reservations it authored keep their author. A retry keeps the first
      deletion instant.
3. Any retryable provider failure, and a section that can't take the lock
   or find the account (`CustomerAccountAccessError`), throws before Better
   Auth removes the identity rows, so deletion stays retryable. The link row goes by cascade;
   the customer account row stays.

The marker blocks profile, reservation, checkout, and resolver activity but
still allows reauthentication, logout, and delete retry. Resolution, profile
edits, and deletion each re-read authority inside their account section. Never delete
retained Dotypos reservations, payments, invoices, or legal evidence.
