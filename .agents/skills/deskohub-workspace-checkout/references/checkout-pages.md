# Reservation, Pay, and status pages

## Availability

`WorkspaceAvailabilityService.getAvailability` (`features/reservation/backend/workspace-availability.service.ts`) is advisory. It reads `AdvisoryAvailabilityInventory`, whose tables, active Dotypos reservations, and Calendar limitations come from shared `"use cache: remote"` snapshots in `features/reservation/backend/availability-inventory-cache.server.ts`, using the `availabilityTables`, `availabilityCalendar`, and `availabilityReservations` `cacheLife` profiles in `next.config.mjs`.

- `ensureAvailable` and table assignment always read the providers directly. Never route them through `AdvisoryAvailabilityInventory`.
- The expired-hold query always runs live.
- Cache only the `ReservationRecord` projection (`toReservationRecord`, `features/reservation/backend/reservation-record.ts`), never customer IDs or notes. Key snapshots by the normalized Prague-midnight range.
- Every Dotypos create, update, or cancel through `WorkspaceDotyposLayer` calls `expireCacheTag` on the availability reservations tag and the [reservation records](#reservation-records) tag. It uses `expire: 1` because `expire: 0` makes a calling Server Action re-render the page. Hold confirmation leaves occupancy unchanged, so it expires only the reservation records tag.
- Invalidation is best effort and never fails the write. `revalidateTag` can't run during render, so writes from render paths, or made outside the app, show up within the reservations profile lifetime.
- Mark a failed snapshot load uncacheable with `cacheLife({ expire: 0 })` before it rejects.
- Reference a `"use cache"` function only inside a callback, never as a value during module evaluation. The compiler turns it into a binding assigned later, so an eager reference is `undefined` and fails the build during page-data collection.
- Cowork selection queries request only the selected date; only the calendar range query spans the booking horizon.
- Gate Submit on pending availability for the current selection, not on a background refetch. `ensureAvailable` re-checks on submit.

### Edit from Pay

A reservation page restored from signed Pay state shows availability as it will be after supersession:

- Carry the signed restoration context separately from the public selection query. Never accept a client-authored reservation ID as the exclusion.
- Exclude only that checkout's verified current replaceable hold, after confirming in the inventory snapshot that it's still Dotypos `NEW`. Keep every other reservation and Calendar limitation.
- Keep `ensureAvailable` and table assignment structurally unable to receive an exclusion. Submission cancels the old hold, then runs the full availability check before creating the replacement.

## Reservation records

- Customer-facing reads of Dotypos reservation details go through `ReservationRecords` (`features/reservation/backend/reservation-records.ts`). `CheckoutStatusService` and `CustomerReservationHistoryService` take the records layer through `withRecords`. Their `Live` layers, which the status page and account history use, read `ReservationRecords.Live`, so a staff edit in Dotypos shows on the next load; keep browser pages live. Only the MCP read tools (`CustomerAgentToolsLive`) pass `SharedReservationRecordsLive`, because agent reads are the quota risk. Booking checks, fulfillment, cleanup, and writes read Dotypos directly.
- `SharedReservationRecordsLive` serves `"use cache: remote"` snapshots keyed by reservation ID, Dotypos customer ID, or one sorted batch of at most 50 IDs, with the `reservationRecords` profile and `reservationRecordTags.records`. Its customer list also reads, by ID, the customer's recorded reservations a list snapshot doesn't hold yet; the live list needs no such repair.
- Entries hold only the `ReservationRecord` projection, but a customer-keyed entry still describes that customer's bookings. Read one only after authorizing the reservation or account. Never cache an authorization result, contact details, names, or an assembled history.
- Statuses come from Workspace rows. The status kind never reads Dotypos, and the history shows a row whose `reservationState` is `confirmed` as confirmed while a snapshot still says `NEW`.
- Invalidation is best effort, as for availability. A write made during render or outside the app shows to agents only after a successful refresh. Refreshes are demand-driven: the first read after the 60-second `revalidate` still gets the old snapshot while it starts one. A cold entry still spends Dotypos requests.
- The MCP read tools skip the uncached customer reads: `get_reservation_status` passes `includeSupportContact: false` and `list_my_reservations` passes `includePartyNames: false`. The browser pages keep both.
- Build each service with one records layer per Layer build. Live and shared variants of the same service share its `Default` layer, so mixing them in one build can memoize whichever is built first.

## Page preload

Reservation pages (cowork, meeting room, office) stream every advertised price and the initial availability with the content, so no price or availability skeleton appears or resizes afterward. Each page loads both in parallel inside the existing content Suspense boundary, without `"use cache"`.

- Build availability queries only with the shared builders in `features/reservation/workspace-availability.ts`, from the server's Prague `today`, so page and form produce the same query keys.
- Load availability with `preloadPageAvailability` (`features/reservation/backend/workspace-availability-loader.ts`). The availability route uses the same replacement-token exclusion, so both paths project the same occupancy. Load prices with `preloadPageAdvertisedPrices`.
- Both run through `pagePreload` (`features/reservation/backend/page-preload.ts`). Anything that fails, dies, or misses `pagePreloadDeadline` is omitted and the client fetches it. The deadline only stops the page waiting; remote-cache loads run without a signal, finish, and fill the cache.
- While a replacement's current hold can't be looked up, the page omits availability (it would show the customer's own hold as occupied). The route still loads ordinary availability.
- `useReservationAvailability` seeds `initialData` only for a query whose key hash matches a preloaded one. A fresh seed doesn't refetch on mount; focus, reconnect, `staleTime`, and price polling still apply.
- Content fallbacks mirror the option cards through layout constants exported from `reservation-type-input.tsx`. The office fallback renders `officeSeatOptionsFallbackCount` seat cards because capacity comes from Dotypos inside the boundary. Preload the cowork LCP tier image from the fallback and render it eagerly with high fetch priority.

## Selection in the URL

Each family has one selection link, built with `defineSelectionLink` (`features/reservation/selection-link.ts`): `coworkSelectionLink`, `meetingRoomSelectionLink` and `officeSelectionLink` in `features/reservation/*-selection-link.ts`. Its `params` list, in link order, is the only place the family names its selection parameters. Cowork also lists the retired `tier` as a `legacyParams` entry it still reads.

- From that list the link derives `readSelection` (the forms' `fromSearchParams` and the site tool's selection), `restore` (the Pay-return rule below) and the order `write` names parameters in. `read` is the parser with defaults, the booking horizon and capacity leniency; `fromStored` turns a stored reservation into a selection. Add a parameter to the link, never to a form or caller, and cover `read(write(selection))` round trips and `fromStored` at the link in its colocated test. Contact parameters (`name`, `email`, `phone`, `customer`) are never selection parameters.
- Forms watch their selection with `useWatchedSelection(link, control)` and mirror it with `useReservationSelectionUrl(link, selection)` (`features/reservation/components/use-reservation-selection-url.ts`).
- Every other caller builds reservation page links from a `ReservationSelection` (`features/reservation/selection-path.ts`), the family-tagged selection a link can name: `getSelectionPath(locale, selection)` in the app, `getShareableSelectionPath` or `getShareableReservationUrl(selection)` outside it. A parameter the selection leaves out stays out of the link. Offerings project with `getPublicOfferingSelection` (`features/checkout/public-offerings.ts`).
- The hook writes only after the selection changes, never on first render: on mount it would run before the App Router patches `history.replaceState`, which drops Next's history state. It replaces the entry with `window.history.replaceState(null, "", url)`, which keeps `useSearchParams` in step without a navigation or server round trip.
- The server-rendered `searchParams` prop goes stale after an edit. Build anything that must carry the current selection, such as a sign-in or verify return path from a reservation page, from `useSearchParams` and `usePathname` or from `window.location` when the link is followed.
- The office parser takes `startsOn` only inside the booking window from the server's `today`; the page preloads that start date's prices.
- An absent parameter means "unspecified", which the parser may fill from the customer's last reservation. Encode a deliberate empty choice as an explicit value instead, as cowork writes `monitorOption=none` for an optional workstation turned off.
- Links shared outside the app, such as agent-tool links, pass a `ReservationSelection` to `getShareableReservationUrl`. A quote link passes the whole quoted selection so the last reservation fills nothing; a cowork offer link names only the tier (and date), and leaves both add-ons open. Cowork names its add-ons together or not at all.
- `step` (`reservationCheckoutStepQueryParam`, `features/reservation/reservation-checkout-step.ts`) is `contact` at the contact-details step; absent or any other value means choosing the space. `useReservationCheckoutStep` owns it; the selection writers never write it.
- `contact` (`checkoutContactQueryParam`, `features/reservation/reservation-checkout-contact.ts`) carries what a signed-out visitor typed (name, email, phone, billing, marketing consent) through sign-in. `sealCheckoutContact` seals it with `checkoutContactReturnState` (`makeAuthReturnState`, purpose `checkout-contact`, 30 minutes) into the sign-in's return path, and the page loader opens it. Only that purpose opens it; an expired or foreign token is ignored.
- A failed, cancelled, or expired payment's status page links "Try again" to the original selection. `loadRetrySelection` (`checkout-status.service.ts`) builds the status's `retrySelection` on the server with the family link's `fromStored`, from the stored details plus the Dotypos interval, and the page links it with `getSelectionPath`. A historical cowork tier gives no selection. A Dotypos reservation stays readable after hold cleanup cancels it. Without the interval the link opens the family page without a selection.
- After a Pay return the URL carries `payState` plus the edited selection. The family link's `restore` lets any of its selection parameters beside the token replace the whole restored selection, keeping the token's checkout session, replacement token, contact, and discount intent. The Pay page's edit link carries the token alone, so it still restores the signed selection.

## Contact step and customer mode

Every reservation needs a signed-in account with a verified email; there is no guest checkout. The contact step (`features/reservation/components/reservation-customer-fields.tsx`, seeded by `features/reservation/reservation-existing-customer.ts`) renders one of:

- Signed out: name, email, phone, and billing. Continue seals the details (see `contact` above), sends the sign-in email with `startEmailSignIn`, and opens the verify modal (`use-checkout-email-verification.ts`). The email carries a code only when `login_email_code` is on. "Already a customer? Sign in" opens sign-in with the same return path.
- An account without a link first runs `CustomerAccountResolver` (`loadCheckoutAccount` in `reservation-existing-customer.server.ts`), so a returning customer's exact-email Dotypos profile is linked before the page decides it has none. A profile linked this way counts as an existing profile.
- Signed in without a profile: the same form with the account email read-only; name and phone are required. Submitting creates the Dotypos profile, with billing, and continues. Creation re-resolves under the account lock (`CustomerProfileService.createUnderHeldLock`), so a customer created meanwhile, or by an attempt whose link write failed, is linked rather than duplicated, and its saved profile wins.
- Signed in with a linked profile: the "Booking as" card (`customer: "account"`). If the sealed details came back for an email whose account already has a profile, the card shows a notice and the typed details, minus the email, prefill "Book for someone else".
- Resolution support state (ambiguous, unusable, or claimed exact-email customers): a notice pointing to support, never a form or a retry.
- Account read failure: an error with a retry, never a form.

Booking modes:

- `customer: "account"` makes the server replace the submitted name and email (and phone, when the profile has one) with the linked account contact and book for its Dotypos customer. The client can't pick another account.
- "Book for someone else" (no `customer` in the submission; `customer=contact` in a link) asks for name, email, repeated email (must match), and phone, and submits the typed contact through the ordinary find-or-create path.
- Prefill precedence: restored Pay state (with any edited selection beside it), explicit query values, the customer's last reservation of the family (cowork only when that offer is available on the form's date), then defaults.
- An explicit `customer=account|contact` query parameter selects the mode. Otherwise contact query fields select contact mode, except on office links, which never prefill a contact.
- The marketing checkbox shows for a signed-out visitor, a missing profile, and the account card when consent isn't active or can't be read. Booking for someone else never shows it: consent belongs to the account's own customer.

## Pay page and provider tab

The customer's single Order and pay activation starts checkout (`features/checkout/components/checkout-pay-page.tsx`).

1. Only when the action returns a hosted provider session, open the hosted page in a new tab while activation remains, mark the original tab as owner in tab-local session storage, and navigate it to status.
2. If the browser blocks the tab or activation has expired, navigate the current tab to the provider.

The card explains this handoff above the consent (`CheckoutPayProviderHandoff`), and the pay button names the signed summary total formatted with `formatMoney`. A zero total keeps the plain label and omits the explanation, because no provider is involved.

Never pre-open a placeholder tab or require a second activation. Zero-total completion, `pricing_changed`, validation failures, and any other non-provider result open or manage no tab. Keep the existing scoped Web Lock ownership (`shared/browser/return-window.ts`, `checkout-payment-window.tsx`): the owner holds an exclusive lock scoped to the status path and preempts a returned payment tab; an unmarked returned tab closes when the lock is unavailable or preempted, and stays open if the original tab is gone.

Keep the new tab as the one handoff for every customer, people and agents alike; never branch on user agent or agent detection. #695 decided this from the 2026-10-18 agent eval run (#699). One model, Claude Sonnet, drove three harnesses (playwright-mcp, browser-use, screenshot-only) in en-US and cs-CZ against the preview of `697ad7cee`, 5 runs per task, harness, and locale. In the Nexi payment task the hosted page opened in a new tab in 30/30 runs, and every run switched to it, paid through 3-D Secure, and reached the confirmed status page (10/10 per harness, 15/15 per locale). The switch cost about 2 tool calls (list tabs, select). The new tab fails only for agents that can't see tabs, and none of the tested harnesses is one. Same-tab can't beat 30/30, so reopen the question only with evidence from agents that act in one tab, such as manual checks of commercial cloud-browser agents or production agent-traffic telemetry from #698. To rerun, see [agent evals](../../deskohub-workspace-e2e/references/agent-evals.md).

The provider return route (`app/[locale]/(site)/(minimal-header)/checkout/pay/return/[orderId]/route.ts`) only redirects to the canonical status page. Provider returns may lack auth cookies, so authorization, verification, and reconciliation stay on the status page. The return route exposes no data and grants no access.

## Status page

- `ReservationAuthorizationService.isAuthorized` gates both pages by permission: the status page asks for `view-status`, the access page for `view-access-code`. `reservationAccessPolicy` maps each grant to its permissions: a valid signed token, or the 24-hour access cookie the proxy sets when it exchanges one (checked first, without private reads), and the account linked to the reservation's `dotyposCustomerId` get both; the author's session gets `view-status` only. Submission sets no access cookie; the author's session covers the submitting browser. The author grant needs only an active session (`CustomerAccountReservationOwnership.activeAccountId`), never a linked customer; only the customer grant resolves the link. Change who sees the PIN in the policy, not in the callers. Denial renders `not_found`, except that a signed-out visitor on the status page is redirected to `getAccountSignInPath(locale, statusPath, "reservation")` (`checkout-status-route.tsx`), which returns to the status page (with any `outcome`). The access page doesn't redirect.
- The local checkout lifecycle status is required and structurally separates `not_found` from row-backed statuses. External reservation summary facts are an optional projection: they can be missing after hold cancellation or a Dotypos read failure.
- Late-payment statuses come from the reservation's latest recovery: `pending` or `processing` shows `late_payment_checking`, `refund_required` shows `late_payment_refund`, `review_required` shows `late_payment_review` with the `fulfillment_failed` support link, and `recovered` falls through to normal paid states. A refund owed on a superseded attempt doesn't override a reservation its active attempt paid. Late-payment states never show the original hold's table or map.
- Start-over links from terminal status or invalid Pay state use document navigation. Cache Components can keep the previous reservation route, with its completed action result, in a hidden Activity boundary; client navigation can remount it and replay the stale Pay redirect.

Customer-visible status wording and the support-request rules are in the [checkout specification](../../../../apps/deskohub-workspace/docs/checkout-lifecycle.md#payment-and-fulfillment).

## Browser site tools

- The customer MCP server (`app/api/mcp/route.ts`) serves the public tools to anyone and the signed-in tools (`defineSignedInAgentTool`) to agents with a Workspace OAuth access token. `answerAgentToolMcpRequest`'s `callerTools` appends the tools only one caller may see after its token is verified; the route uses it for the administration tools, which never pass through `customerAgentCatalog` and spend no customer budget. `authorizeAgentToolRequest` answers before the MCP server runs: a token that grants nothing gets a 401 `invalid_token` challenge, a signed-in `tools/call` without a token a 401 challenge naming the tool's scope, and a token without it a 403 `insufficient_scope` challenge. Challenges come from `customerAgentChallenge` in the account auth boundary; never import Better Auth into `features/agent-tools`. A signed-in tool reads the customer only through `CurrentCustomerAgentGrant` and the token-backed account services (`customerAgentAccountServices`), never the browser session, and spends the per-grant and per-account `RequestBudget` (`agent-tool-call-budget.ts`) plus any tool `accountBudget`. Signed-in results never carry access PINs, contact details, or other people's names, and status links never carry the preview bypass secret.
- `features/agent-tools/webmcp/` registers the public read tools as WebMCP site tools, selected by the access each tool publishes in `_meta` ([agent booking view](agent-booking-view.md#tool-metadata-and-resources)), behind the `webmcp_site_tools` release gate (`SiteToolsWhenEnabled` in the site layout). Keep it a removable client-only leaf: feature detection of `document.modelContext` is the only browser branch, registration code loads with `import()` after it, and nothing outside the module depends on it. Never branch on a user agent.
- Read tools come from `/api/mcp` `tools/list` and run through `tools/call`. Never redefine a tool's schema, copy, or logic in the browser.
- `prepare_reservation` exists only while a reservation form is mounted. It quotes through `get_quote`, applies the quote link's selection with the family's link parser (`selection.fromSearchParams`), waits for the form's availability and price, then submits through `ReservationCheckoutForm`'s own `submit` path. Never give it a server path that skips the form's checks or `preparePayState`. Signed out, that path starts the email verification and the tool returns `email_verification_required`; checkout continues once the customer verifies.
- For another family, the same `execute` call opens that family's page and continues on the form it mounts, which publishes itself through `site-tool-catalog.ts`; opening, mounting, and settling share the one readiness bound. Drive a newly published form only after its mounting commit's effects have run: before `useForm`'s own mount effects, `setValue` doesn't reach `useWatch`, so the page would submit the old selection's price.
- A site tool's marketing consent counts only for a literal `true`: it ticks the form's visible checkbox and labels the grant `site_tool`, also on a box that was already ticked. Without the checkbox (an account that already consented), the form sends neither consent field. It never unticks a box, withdraws consent, or touches the Pay page consents.
