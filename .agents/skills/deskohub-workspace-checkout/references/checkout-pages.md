# Reservation, Pay, and status pages

## Availability

`WorkspaceAvailabilityService.getAvailability` (`features/reservation/backend/workspace-availability.service.ts`) is advisory. It reads `AdvisoryAvailabilityInventory`, whose tables, active Dotypos reservations, and Calendar limitations come from shared `"use cache: remote"` snapshots in `features/reservation/backend/availability-inventory-cache.server.ts`, using the `availabilityTables`, `availabilityCalendar`, and `availabilityReservations` `cacheLife` profiles in `next.config.mjs`.

- `ensureAvailable` and table assignment always read the providers directly. Never route them through `AdvisoryAvailabilityInventory`.
- The expired-hold query always runs live.
- Cache only the occupancy projection (`toOccupancyReservation`), never customer IDs or notes. Key snapshots by the normalized Prague-midnight range.
- Every Dotypos create, update, or cancel through `WorkspaceDotyposLayer` calls `expireCacheTag` on the reservations tag. It uses `expire: 1` because `expire: 0` makes a calling Server Action re-render the page. Hold confirmation leaves occupancy unchanged and doesn't invalidate.
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

## Page preload

Reservation pages (cowork, meeting room, office) stream every advertised price and the initial availability with the content, so no price or availability skeleton appears or resizes afterward. Each page loads both in parallel inside the existing content Suspense boundary, without `"use cache"`.

- Build availability queries only with the shared builders in `features/reservation/workspace-availability.ts`, from the server's Prague `today`, so page and form produce the same query keys.
- Load availability with `preloadPageAvailability` (`features/reservation/backend/workspace-availability-loader.ts`). The availability route uses the same replacement-token exclusion, so both paths project the same occupancy. Load prices with `preloadPageAdvertisedPrices`.
- Both run through `pagePreload` (`features/reservation/backend/page-preload.ts`). Anything that fails, dies, or misses `pagePreloadDeadline` is omitted and the client fetches it. The deadline only stops the page waiting; remote-cache loads run without a signal, finish, and fill the cache.
- While a replacement's current hold can't be looked up, the page omits availability (it would show the customer's own hold as occupied). The route still loads ordinary availability.
- `useReservationAvailability` seeds `initialData` only for a query whose key hash matches a preloaded one. A fresh seed doesn't refetch on mount; focus, reconnect, `staleTime`, and price polling still apply.
- Content fallbacks mirror the option cards through layout constants exported from `reservation-type-input.tsx`. The office fallback renders `officeSeatOptionsFallbackCount` seat cards because capacity comes from Dotypos inside the boundary. Preload the cowork LCP tier image from the fallback and render it eagerly with high fetch priority.

## Selection in the URL

Each reservation form mirrors its selection into the page URL through `useReservationSelectionUrl` (`features/reservation/components/use-reservation-selection-url.ts`).

- Each family's writer sits beside its link parser in `features/reservation/*-reservation-checkout-query.ts` and returns `ReservationSelectionSearchParams` with the parameter names the parser reads. Keep the two inverse and cover the round trip in the parser's test. The type rejects contact parameters (`name`, `email`, `phone`, `customer`); never write them.
- The hook writes only after the selection changes, never on first render: on mount it would run before the App Router patches `history.replaceState`, which drops Next's history state. It replaces the entry with `window.history.replaceState(null, "", url)`, which keeps `useSearchParams` in step without a navigation or server round trip.
- The server-rendered `searchParams` prop goes stale after an edit. Build anything that must carry the current selection, such as a sign-in or verify return path from a reservation page, from `useSearchParams` and `usePathname` or from `window.location` when the link is followed.
- The office parser takes `startsOn` only inside the booking window from the server's `today`; the page preloads that start date's prices.
- An absent parameter means "unspecified", which the parser may fill from the customer's last reservation. Encode a deliberate empty choice as an explicit value instead, as cowork writes `monitorOption=none` for an optional workstation turned off.
- Links shared outside the app, such as agent-tool links, pass the same writers to `getShareableReservationUrl`. A quote link passes the whole quoted selection so the last reservation fills nothing; an offer link that leaves add-ons open uses `getCoworkOfferSearchParams`.
- `step` (`reservationCheckoutStepQueryParam`, `features/reservation/reservation-checkout-step.ts`) is `contact` at the contact-details step; absent or any other value means choosing the space. `useReservationCheckoutStep` owns it; the selection writers never write it.
- `contact` (`checkoutContactQueryParam`, `features/reservation/reservation-checkout-contact.ts`) carries what a signed-out visitor typed (name, email, phone, billing, marketing consent) through sign-in. `sealCheckoutContact` seals it with `checkoutContactReturnState` (`makeAuthReturnState`, purpose `checkout-contact`, 30 minutes) into the sign-in's return path, and the page loader opens it. Only that purpose opens it; an expired or foreign token is ignored.
- A failed, cancelled, or expired payment's status page links "Try again" to the original selection. `loadRetrySearchParams` (`checkout-status.service.ts`) builds it on the server with the family's `getStored*ReservationSelectionSearchParams`, which sit beside the writers and feed them, from the stored details plus the Dotypos interval. A Dotypos reservation stays readable after hold cleanup cancels it. Without the interval the link opens the family page without a selection.
- After a Pay return the URL carries `payState` plus the edited selection. Each family's `get*RestoredReservationValues` lets selection parameters beside the token replace the restored selection (`hasReservationSelectionSearchParams`), keeping the token's checkout session, replacement token, contact, and discount intent. The Pay page's edit link carries the token alone, so it still restores the signed selection.

## Contact step and customer mode

Every reservation needs a signed-in account with a verified email; there is no guest checkout. The contact step (`features/reservation/components/reservation-customer-fields.tsx`, seeded by `features/reservation/reservation-existing-customer.ts`) renders one of:

- Signed out: name, email, phone, and billing. Continue seals the details (see `contact` above), sends the sign-in email with `startEmailSignIn`, and opens the verify modal (`use-checkout-email-verification.ts`). The email carries a code only when `login_email_code` is on. "Already a customer? Sign in" opens sign-in with the same return path.
- Signed in without a profile: the same form with the account email read-only; name and phone are required. Submitting creates the Dotypos profile, with billing, and continues.
- Signed in with a linked profile: the "Booking as" card (`customer: "account"`). If the sealed details came back for an email whose account already has a profile, the card shows a notice and the typed details, minus the email, prefill "Book for someone else".
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

The card explains this handoff above the consent (`CheckoutPayProviderHandoff`), and the pay button names the signed summary total formatted with `formatWorkspaceMoney`. A zero total keeps the plain label and omits the explanation, because no provider is involved.

Never pre-open a placeholder tab or require a second activation. Zero-total completion, `pricing_changed`, validation failures, and any other non-provider result open or manage no tab. Keep the existing scoped Web Lock ownership (`shared/browser/return-window.ts`, `checkout-payment-window.tsx`): the owner holds an exclusive lock scoped to the status path and preempts a returned payment tab; an unmarked returned tab closes when the lock is unavailable or preempted, and stays open if the original tab is gone.

Keep the new tab as the one handoff for every customer, people and agents alike; never branch on user agent or agent detection. #695 decided this from the 2026-10-18 agent eval run (#699). One model, Claude Sonnet, drove three harnesses (playwright-mcp, browser-use, screenshot-only) in en-US and cs-CZ against the preview of `697ad7cee`, 5 runs per task, harness, and locale. In the Nexi payment task the hosted page opened in a new tab in 30/30 runs, and every run switched to it, paid through 3-D Secure, and reached the confirmed status page (10/10 per harness, 15/15 per locale). The switch cost about 2 tool calls (list tabs, select). The new tab fails only for agents that can't see tabs, and none of the tested harnesses is one. Same-tab can't beat 30/30, so reopen the question only with evidence from agents that act in one tab, such as manual checks of commercial cloud-browser agents or production agent-traffic telemetry from #698. To rerun, see [agent evals](../../deskohub-workspace-e2e/references/agent-evals.md).

The provider return route (`app/[locale]/(site)/(minimal-header)/checkout/pay/return/[orderId]/route.ts`) only redirects to the canonical status page. Provider returns may lack auth cookies, so authorization, verification, and reconciliation stay on the status page. The return route exposes no data and grants no access.

## Status page

- `ReservationAuthorizationService.isAuthorized` gates both pages by permission: the status page asks for `view-status`, the access page for `view-access-code`. `reservationAccessPolicy` maps each grant to its permissions: a valid signed token, or the 24-hour access cookie the proxy sets when it exchanges one (checked first, without private reads), and the account linked to the reservation's `dotyposCustomerId` get both; the author's session gets `view-status` only. Submission sets no access cookie; the author's session covers the submitting browser. The author grant needs only an active session (`CustomerAccountReservationOwnership.activeAccountId`), never a linked customer; only the customer grant resolves the link. Change who sees the PIN in the policy, not in the callers. Denial renders `not_found`, except that a signed-out visitor on the status page is redirected to `getAccountSignInPath(locale, statusPath, "reservation")` (`checkout-status-route.tsx`), which returns to the status page (with any `outcome`). The access page doesn't redirect.
- The local checkout lifecycle status is required and structurally separates `not_found` from row-backed statuses. External reservation summary facts are an optional projection: they can be missing after hold cancellation or a Dotypos read failure.
- Late-payment statuses come from the reservation's latest recovery: `pending` or `processing` shows `late_payment_checking`, `refund_required` shows `late_payment_refund`, `review_required` shows `late_payment_review` with the `fulfillment_failed` support link, and `recovered` falls through to normal paid states. A refund owed on a superseded attempt doesn't override a reservation its active attempt paid. Late-payment states never show the original hold's table or map.
- Start-over links from terminal status or invalid Pay state use document navigation. Cache Components can keep the previous reservation route, with its completed action result, in a hidden Activity boundary; client navigation can remount it and replay the stale Pay redirect.

Customer-visible status wording and the support-request rules are in the [checkout specification](../../../../apps/deskohub-workspace/docs/checkout-lifecycle.md#payment-and-fulfillment).
