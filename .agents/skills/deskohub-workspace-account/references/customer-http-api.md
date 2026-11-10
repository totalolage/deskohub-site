# Customer HTTP API

The signed-in customer's API for the native app and other first-party
clients, served at `/api/customer`. The Better Auth session cookie
authenticates every request.
The app's client and data layer are in the `deskohub-mobile` skill
(`references/package-layout.md`).

## Where things live

- Contract: `packages/workspace-customer-api` (portable: Effect only, no
  Next, Node, React, Better Auth, or `@/` imports; `import-boundary.test.ts`
  enforces it). `workspace-customer-api.ts` composes the `account`,
  `reservations`, and `booking` groups into `WorkspaceCustomerApi`; each group
  has its own file (`customer-reservations-api.ts`, `customer-booking-api.ts`).
  `./client` holds the typed client factories, `./referral-code` the
  browser-safe `ReferralCode` brand.
- Adapter: `features/customer-api/`. `customer-api.server.ts` builds the
  handler groups into `makeWorkspaceCustomerApiLayer`;
  `customer-request-checks.ts` implements the two middlewares;
  `customer-request-budget.ts` classifies endpoints for the request budget;
  `customer-api-failure.ts` maps failures to public errors;
  `customer-account-layers.ts` and `customer-reservation-layers.ts` carry the
  per-request account and reservation Layers.
- Route: `app/api/customer/[...path]/route.ts`, through
  `defineWorkspaceHttpApiRoute` (`shared/backend/workspace-http-api-route.ts`).

## Adding an endpoint

1. Declare it in its group's contract file. Add new groups to
   `WorkspaceCustomerApi` before `.prefix()` and `.middleware()`: each applies
   only to groups already added, so a later group would skip the prefix and
   both checks. `workspace-customer-api.test.ts` pins every group, the prefix,
   and the middleware order.
2. Give it fixed-code tagged errors with an HTTP status
   (`HttpApiSchema.status`), as the account errors do. A response variant,
   status, or reason the shipped app can't decode is a breaking change:
   version it instead.
3. Implement it in the group's `HttpApiBuilder.group` in the adapter, in the
   group's own handlers module (`customer-account-handlers.ts`,
   `customer-reservation-handlers.ts`, `customer-booking-handlers.ts`, which
   joins `customer-booking-catalog-handlers.ts` and
   `customer-booking-checkout-handlers.ts`).
4. Classify it in `customerRequestBudgetClasses`. The Record is exhaustive
   over the contract, so an unclassified endpoint is a type error, and
   `customer-request-budget.test.ts` pins the endpoint counts: update them.
   Every endpoint spends the account's general budget (120 per 10 minutes).
   An endpoint is Dotypos-backed when it, or the account resolution it starts
   with, can call Dotypos (resolving an unlinked account looks its customer up
   and may reactivate an expired one). A GET the app repeats on every load,
   history visit or status poll (the account, the reservation history, an
   order's status and its door code) is `account-read` (40 per 30 minutes);
   any other Dotypos-backed GET (consent, referrals, the invoice) is
   `dotypos-read` (20 per 30 minutes); any other method is `dotypos-mutation`
   (15 per 30 minutes, which account edits and checkout steps share; two
   bookings fit). Each has its own per-account budget so reads can't use up
   what edits, bookings and deletion need; the test checks the method.
   Opening the app costs two account reads and a booking up to thirteen (the
   account, the status once plus up to nine payment-return polls, the history
   and the door code), so two bookings and a session's navigation (about 38)
   fit; `customer-request-checks.test.ts` replays that session. The app's
   advisory counter (`apps/deskohub-mobile/src/customer-api/account-read-budget.ts`)
   mirrors the `account-read` budget and stops automatic status polling while
   fewer than eight reads are left: change both together. The booking catalog's reads
   (offerings, availability, meeting-room start times, quotes) are
   `catalog-read` (120 per 10 minutes): they read the shared snapshots, which
   call Dotypos only on a miss, and a booking compares several dates before it
   checks out, so they keep off the account read budget. `workspace-only` reads or writes only the Workspace database
   and Better Auth, as the account's language save (`updateLocale`) does. Account reads count as Dotypos-backed: they read Dotypos live,
   with no response cache. If the
   endpoint changes the Dotypos call rate, recheck the budget numbers against
   the site's shared 150 requests per 30 minutes. Per-account budgets bound one account's share;
   they can't keep the whole site within that allowance.
5. Regenerate the OpenAPI golden from `packages/workspace-customer-api` with
   `UPDATE_OPENAPI=1 bun test src/workspace-customer-api.test.ts`, and review
   its diff as the contract change it is.

## Handler rules

- Every request passes the origin check, then the session check, before the
  handler: the last middleware added runs first. The origin check refuses
  (403 `CustomerRequestRejected`), on every method, a request without the
  `x-deskohub-client: workspace-customer-api` header (`customerApiClientHeader`,
  the CSRF guard: a cross-site page can't send it without a preflight the API
  never grants), one marked `Sec-Fetch-Site: cross-site`, or one whose
  `Origin` Better Auth doesn't trust. Native clients send no `Origin`. The
  session check answers 401 without a verified session, then spends the
  request budget (429 exhausted, 503 when it can't be checked). Endpoints add
  no checks of their own.
- Read the signed-in customer from `CurrentCustomerSession`. Request headers
  and the visitor come from the Workspace request context, which
  `WorkspaceRouterRequestContext` opens per request in
  `makeWorkspaceCustomerApiLayer`; read them through
  `shared/backend/workspace-request-context.ts`, never from module state.
- Build service Layers inside the handler from a Layers service the adapter
  provides (`CustomerAccountLayers` for account services and release gates,
  `CustomerBookingCatalogLayers` and `CustomerBookingCheckoutLayers` for
  booking, `CustomerReservationLayers` for reservation services), so a Layer
  that can't be built fails only the requests that use it, as unavailable.
  Provide every set that carries a release gate, directly or nested (pricing's
  discount gates, a status refresh's seating-map gate), with
  `providePerRequest`, so its `…ForRun` gate decides for that request alone;
  see the Effect skill's "Request state in HTTP APIs". Tests swap the Layers
  service for fakes, and an endpoint that reads a gate has an overlapping
  test with `answerInEachReleaseCohort`.
- End every handler in `answerCustomerApiFailure(operation)` or its group's
  equivalent: an account access failure maps to its fixed public error
  (`accountAccessApiFailure`), anything else to 503
  `CustomerServiceUnavailable`, and only fixed codes reach the log. Never put
  provider messages, identifiers, or customer data in a public error.
- Mutations run to completion when the client disconnects: the route serves
  every method with `continue-after-disconnect` and passes every method but
  GET and HEAD through `continueMutationsAfterDisconnect`.
  Keep reads on GET so they still stop with the client. A GET whose port
  provisions or finalizes something, such as the order status refresh or the
  door code, runs that call to completion like a mutation: wrap it in
  `runToCompletion` (`shared/backend/run-to-completion.ts`).
- A file download declares its success as bytes with
  `HttpApiSchema.asUint8Array({ contentType })`, so the OpenAPI document and
  the typed client treat the body as binary. Return an
  `HttpServerResponse.uint8Array` when the file needs a header the success
  schema can't carry, such as `Content-Disposition`, as `getReservationInvoice`
  does; the router still marks it private and uncached. Describe that header
  in the OpenAPI document with `.annotateMerge(responseHeaders(200, { ... }))`
  (`src/openapi-response-headers.ts`) and regenerate the golden.
- A reservation service that decides who may see an order takes the
  authorization the handler built from the session's authentication
  (`ReservationAuthorizationService.withAuthentication`), through the
  service's `withAuthorization`, never `ReservationAuthorizationService.Live`.
- Don't validate an upload from the endpoint's multipart part stream: Effect
  lets the body's end overwrite a parser failure from the same chunk, and its
  part limit counts the part's headers. Parse the handler's `request` body as
  `customer-avatar-upload.ts` does, with `Multipasta`, keeping the first
  failure.
- A client that keeps the remembered referral code sends it in
  `x-deskohub-referral-code`; declare that header on endpoints that read it
  and serve it through `RememberedReferral.fromClient` (see the referrals
  skill).
- Sign-in, sign-out, passkeys, and other Better Auth operations aren't
  customer API endpoints. Better Auth serves them at `/api/auth`, and
  `CustomerAuthApi` (`customer-auth-api.ts`) is their client-only contract.
  When you call a new one from the app, add it there;
  `features/account/backend/auth/customer-auth-api-drift.test.ts` checks each
  entry's path and method against Better Auth's own endpoints and that none is
  disabled.
- The app names its locale on the sign-in code and magic-link verification in
  `customerSignInLocaleHeader`, a `CustomerLocale`
  (`@deskohub/workspace-customer-api/customer-locale`, an Effect-only entry
  point the app bundles without the HTTP API). The account it creates takes it
  as its language; see the locale-preference reference.
- The app's language setting saves the account's language with
  `PUT /account/locale` (`updateLocale`): a strict `{ locale: CustomerLocale }`
  body, echoed on success, and no locale header. It is the web switcher's
  guarded write, so it needs no Dotypos profile and answers 409
  `deletion-pending` while deletion is pending. Every signed-in
  `CustomerAccountState` carries the saved `locale`, and the typed
  `get-session` user may carry it, both as any string or null: a response tag
  stays open so a locale added later never breaks an older app's decoding,
  while the request stays strict.

## Booking checkout

The booking group's checkout endpoints (`customer-booking-checkout-api.ts`,
handlers in `customer-booking-checkout-handlers.ts`) call the same shared
operations the site's booking form, Pay page and agent tools call:
`prepareWorkspacePayState`, `applyDiscountCodeToPayState`, the Pay state
price acceptance, and `CheckoutService.createHostedPaymentCheckout`.

Flow:

1. `getQuote` prices a selection and returns its `advertisedPriceToken`.
2. `createCheckout` holds the selection and returns a `CustomerCheckout`
   with a `payStateToken`, the summary, `expiresAt`, and whether submitting
   needs early-performance consent. `bookingFor: "self"` books as the
   account's own profile and Dotypos customer; the submitted contact only
   completes a profile that isn't linked yet. `"someone-else"` books the
   submitted contact. A review account gets `payment_disabled`: nothing is
   reserved and there's no token.
3. Optionally `applyCheckoutDiscountCode`. A rejected code answers 422 and
   leaves the checkout usable; when the server signed a replacement that keeps
   the attempted code, the error carries its token. An unknown Calendar
   discount or a provider outage, the referral store's included, answers 503,
   never a price review or a rejected code.
4. A `price_review` checkout shows the new summary and calls
   `acceptCheckoutPriceChange`, the same continuation the Pay page's link
   issues. Acceptance needs only the token: it doesn't renew the hold, so the
   hold can end before the token's `expiresAt`, and submission checks the hold
   and the price again.
5. `submitCheckout` sends the consents and the legal documents the client
   showed, as `listLegalDocuments` listed them. Documents that changed since
   answer 409 `CustomerLegalDocumentsChanged`: list them again and ask again.
   `payment_required` opens `paymentUrl` (Nexi). Nexi returns to the site's
   return route, which redirects to the reservation status page; the app deep
   links to `statusUrl`. `paid` needs no payment. A checkout whose payment
   started or that can no longer be paid answers 409 reason `not_payable`:
   open the status screen.

   Optional `returnTarget` (`native-app` or `web-app`, never a URL) sends the
   payment's return to the app instead:
   `deskohub://reservations/{orderId}?after=payment` (`nativeApp.scheme`; it
   ends the app's auth-session browser) or
   `{callback origin}/app/reservations/{orderId}?after=payment` (with the
   Preview protection bypass on Preview). `after=payment` switches the app's
   reservation screen to its post-payment polling, also on a cold start. `statusUrl`, `paid` included, is that same URL, built
   by `getPaymentReturnDestination`. Nexi's result and cancel URLs stay the
   https return route; the target travels in
   `workspace_reservations.payment_return_target`, which every submission that
   hands out a payment page overwrites (a site submission clears it), so a
   reused hosted page returns where the latest answer points. The route reads
   it by order id without a session and falls back to the site status page
   when the lookup fails; nothing in its query picks the destination. The
   app's status call (`returnOutcome: "unknown"`) reconciles the payment.

Author check: discount-code, price-acceptance and submit open the token and
answer 404 `CustomerCheckoutNotFound` unless the signed-in account authored
the held reservation (`authorAccountId`), so a token alone never acts for
another account. A repository failure answers 503.

Referral fields: the client keeps the remembered referral code and sends it in
`x-deskohub-referral-code`. `RememberedReferral.fromClient` writes nothing, so
`customer-referral-updates.ts` records what the site would have written to its
cookie and the handler reports it: `rememberReferralCode` after an accepted
referral code while the referral release is open, and
`rememberedReferralCodeUsed` once a paid booking settles the referral. The
client stores or drops the code accordingly. `referralApplied` means the
signed price includes the invited customer's benefit; only `createCheckout`
reports it, from the hold's own check (later steps answer an accepted
referral code as `discountCode: "referral_accepted"`).

Bot protection: the site's booking actions call BotID, which needs the
browser's JavaScript challenge; a native client can't run it, so these
endpoints don't. They rely instead on a verified Better Auth session (native
sign-in starts in the site-origin browser flow, which runs BotID), the origin
and client-header check, the per-account request budgets, and the same
server-side checks every booking passes: the sealed Pay state, the hold,
repricing, consent, and legal evidence. BotID stays in the site action
wrappers, outside the shared operations, so the HTTP API never reaches it.

Wiring: each request builds its operations from
`CustomerBookingCheckoutLayers` (`customer-booking-checkout-layers.ts`).
`CustomerCheckoutOperations` (`customer-checkout-operations.service.ts`)
closes over the request's referral and office gates (their `…ForRun`
layers) and its `CustomerReferralUpdates`, so the selection, the shared
operation and the referral record share one decision per gate; preparation
provides the gates to `ReservationBooking.Live`. Each operation
builds its own services when it runs: acceptance builds only the sealing
keys, and services that can't be built answer 503. A checkout state the
server fails to seal or sign also answers 503, never `expired`: only the
client's own token can expire. Mutations keep their site
actions' deadlines (`getPreparePayStateDeadline`,
`getApplyDiscountCodeDeadline`, `getCheckoutSubmitDeadline`); one that runs
out answers 503. Handler tests fake `CustomerCheckoutOperations` and
`CheckoutService` through the `bookingCheckout` option of
`makeCustomerApiTestServer`.

## Tests

Each endpoint gets colocated tests through `makeCustomerApiTestServer`
(`customer-api.test-utils.ts`), which runs the real adapter over session,
origin, budget, service, and release-gate fakes:
`testCustomerEndpointGuards(call)` registers the signed-out 401 and
cross-site 403 cases; add a happy path and at least one domain failure, as
the `updateProfile` tests in `customer-account-handlers.test.ts` do. Budget
fakes come from `makeMemoryRequestBudget`
(`shared/backend/request-budget/memory-request-budget.test-utils.ts`).
Send a streamed body that the handler stops reading early as a `NextRequest`
through `defineWorkspaceHttpApiRoute`, as the route serves it: Bun never
settles `cancel()` on a plain streamed `Request` that the served handler
re-wraps, so such a test hangs.
