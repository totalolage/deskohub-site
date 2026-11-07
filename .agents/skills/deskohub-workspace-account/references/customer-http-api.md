# Customer HTTP API

The signed-in customer's API for the native app and other first-party
clients, served at `/api/customer`. The Better Auth session cookie
authenticates every request.

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
  `customer-account-layers.ts` carries the per-request account Layers.
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
3. Implement it in the group's `HttpApiBuilder.group` in the adapter. The
   `reservations` and `booking` groups are pass-through placeholders in
   `customer-api.server.ts`; give each its own handlers module, as
   `customer-account-handlers.ts` is for `account`.
4. Classify it in `customerRequestBudgetClasses`. The Record is exhaustive
   over the contract, so an unclassified endpoint is a type error, and
   `customer-request-budget.test.ts` pins the endpoint counts: update them.
   Every endpoint spends the account's general budget. An endpoint is
   Dotypos-backed when it, or the account resolution it starts with, can call
   Dotypos (resolving an unlinked account looks its customer up and may
   reactivate an expired one): a GET is `dotypos-read`, any other method
   `dotypos-mutation`, each with its own per-account budget so reads can't
   use up what edits and deletion need; the test checks the method.
   `workspace-only` reads only the Workspace database and Better Auth.
   Reservation reads count: they read Dotypos live. If the endpoint changes
   the Dotypos call rate, recheck the budget numbers against the site's shared
   150 requests per 30 minutes. Per-account budgets bound one account's share;
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
- Build service Layers inside the handler, per request, from a Layers service
  the adapter provides (`CustomerAccountLayers` for account services and
  release gates). A release gate then decides once per request (its `…ForRun`
  layer, see the feature-flags skill), and a Layer that can't be built fails
  only the requests that use it, as unavailable. Tests swap the Layers service
  for fakes.
- End every handler in `answerCustomerApiFailure(operation)` or its group's
  equivalent: an account access failure maps to its fixed public error
  (`accountAccessApiFailure`), anything else to 503
  `CustomerServiceUnavailable`, and only fixed codes reach the log. Never put
  provider messages, identifiers, or customer data in a public error.
- Mutations run to completion when the client disconnects: the route passes
  every method but GET and HEAD through `continueMutationsAfterDisconnect`.
  Keep reads on GET so they still stop with the client.
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

## Tests

Each endpoint gets colocated tests through `makeCustomerApiTestServer`
(`customer-api.test-utils.ts`), which runs the real adapter over session,
origin, budget, service, and release-gate fakes:
`testCustomerEndpointGuards(call)` registers the signed-out 401 and
cross-site 403 cases; add a happy path and at least one domain failure, as
the `updateProfile` tests in `customer-account-handlers.test.ts` do. Budget
fakes come from `makeMemoryRequestBudget`
(`shared/backend/request-budget/memory-request-budget.test-utils.ts`).
