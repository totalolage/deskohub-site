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

## Customer mode

A signed-in, linked customer books with the account card by default.

- `customer: "account"` makes the server replace the submitted name and email (and phone, when the profile has one) with the linked account contact and book for its Dotypos customer. The client can't pick another account.
- "Book for someone else" submits the typed contact through the ordinary find-or-create path.
- Prefill precedence: restored Pay state, explicit query values, the customer's last reservation of the family (cowork only when that offer is available on the form's date), then defaults.
- An explicit `customer=account|contact` query parameter selects the mode. Otherwise contact query fields select contact mode, except on office links, which never prefill a contact.
- The marketing checkbox is omitted when the account card books for a customer whose consent is active, and shown in contact mode or when consent can't be read.

## Pay page and provider tab

The customer's single Order and pay activation starts checkout (`features/checkout/components/checkout-pay-page.tsx`).

1. Only when the action returns a hosted provider session, open the hosted page in a new tab while activation remains, mark the original tab as owner in tab-local session storage, and navigate it to status.
2. If the browser blocks the tab or activation has expired, navigate the current tab to the provider.

Never pre-open a placeholder tab or require a second activation. Zero-total completion, `pricing_changed`, validation failures, and any other non-provider result open or manage no tab. Keep the existing scoped Web Lock ownership (`shared/browser/return-window.ts`, `checkout-payment-window.tsx`): the owner holds an exclusive lock scoped to the status path and preempts a returned payment tab; an unmarked returned tab closes when the lock is unavailable or preempted, and stays open if the original tab is gone.

The provider return route (`app/[locale]/(site)/(minimal-header)/checkout/pay/return/[orderId]/route.ts`) only redirects to the canonical status page. Provider returns may lack auth cookies, so authorization, verification, and reconciliation stay on the status page. The return route exposes no data and grants no access.

## Status page

- The local checkout lifecycle status is required and structurally separates `not_found` from row-backed statuses. External reservation summary facts are an optional projection: they can be missing after hold cancellation or a Dotypos read failure.
- Late-payment statuses come from the reservation's latest recovery: `pending` or `processing` shows `late_payment_checking`, `refund_required` shows `late_payment_refund`, `review_required` shows `late_payment_review` with the `fulfillment_failed` support link, and `recovered` falls through to normal paid states. A refund owed on a superseded attempt doesn't override a reservation its active attempt paid. Late-payment states never show the original hold's table or map.
- Start-over links from terminal status or invalid Pay state use document navigation. Cache Components can keep the previous reservation route, with its completed action result, in a hidden Activity boundary; client navigation can remount it and replay the stale Pay redirect.

Customer-visible status wording and the support-request rules are in the [checkout specification](../../../../apps/deskohub-workspace/docs/checkout-lifecycle.md#payment-and-fulfillment).
