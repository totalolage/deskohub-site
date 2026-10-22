# Administration dashboard

The dashboard lives in `apps/deskohub-workspace/app/[locale]/admin` and `features/administration`. The [administration specification](../../../../apps/deskohub-workspace/docs/administration-dashboard.md) defines navigation, operator-visible statuses, metric definitions, and invoice presentation. This reference covers how to implement them.

## Rendering

- Keep the layout, brand, navigation, and page frame in the static shell. The admin layout doesn't call `connection()` or await request or provider data. Put route-dependent client hooks, such as `usePathname()`, behind their own narrow Suspense boundary.
- Keep identity controls, such as logout or an avatar, out of the shell. Request-derived identity stays inside each page's authorization and Suspense boundaries.
- Start data promises without awaiting them, render stable page controls immediately, and pass each promise to the smallest async Server Component that needs it. Wrap each delayed count, filter set, collection, detail panel, or modal in a layout-matched fallback. Route-level `loading.tsx` files are only the navigation safety net.
- Authorize every protected loader through `authorizeAdministratorPage` and every Server Action or route through `requireAdministratorAuthorization`, both in `features/administrators/server/administrator-authorization.server.ts`. Each reads the Better Auth session and the `administrator` grant from the database on every request; never cache the result past the request. The page guard is wrapped in React `cache()`, so streamed leaves share one check per request. It sends a signed-out visitor to sign-in with `returnTo` (the path the proxy forwards in `x-deskohub-administration-path`) and answers a signed-in account without the grant with `notFound()`. The action guard returns the `AdministratorAccountActor` and fails closed with `AdministratorUnauthorizedError`; it never redirects, so a Server Action can't loop through sign-in. Take the actor for provenance from these guards, never from input.
- Parallelize independent reads, and never persistently cache live operator data. Load only the projection a page displays. For example, Codes doesn't wait for Calendar sales, and breadcrumbs use static labels or narrow label loaders, not full detail loaders.
- `/admin/administrators` lists, grants, and revokes the administrator role through `AdministratorRoster` (`features/administrators/backend/administrator-roster.service.ts`). A grant needs an existing verified account without pending deletion (`findActiveCustomerAccountByEmail`); there are no pending grants. The service refuses to revoke the acting administrator's own grant.
- `/admin/discounts` redirects to `/admin/codes`. Bookings, orders, and operations routes remain diagnostic fallbacks for records not linked to a reservation. Keep them out of primary navigation.

## Data ownership

The dashboard composes these sources without creating a second customer or reservation store:

- Workspace Postgres decides which reservations belong to Workspace and owns workflow state, milestone timestamps, payment attempts, and applied-discount snapshots.
- Dotypos supplies current booking dates and customer contact details. A missing or unavailable Dotypos record never hides a Workspace reservation.
- Nexi supplies live order and operation details for linked payment attempts. Provider IDs stay visible and link to XPay when Nexi is unavailable.
- PostHog adds optional lifecycle observations to one reservation's timeline. It never decides current status, and lists never query it.

Review accounts' bookings never appear: the review sandbox stores them in `review_account_holds`, which no administration projection, export, or metric reads (checkout skill's lifecycle reference).

When a provider is unavailable, show the affected value as unavailable. Don't substitute a local value that answers a different question, and don't return partial counts.

Keep customer search by name or email in a protected server action. Never put contact data in URLs or persist it. URLs may carry the Dotypos customer ID, status groups, reservation types, dates, and page numbers.

Projections exclude Workspace access codes, payment security tokens, provider redirect URLs, Dotypos notes, raw provider responses, and raw PostHog property bags. A reservation exposes only the safe access-grant fields: state, access name, interval, device, provider credential ID, issuance and failure timestamps, and failure code.

## Reservation list

The page loader applies the default date range with `getAdministrationReservationListDateRange`: from January 1 of the current Prague year, with no upper bound. It passes the effective range back so date controls, sort links, and pagination carry it. A `customerId` list gets no default range. Keep the default in the UI loader. `AdministrationService.listReservations` and `dhw reservations list` treat an absent range as unbounded.

## List export

A list's CSV export is a GET route beside its page, `app/[locale]/admin/<list>/export/route.ts`, built with `defineAdministrationListExportRoute` (`features/administration/list-export.server.ts`). The factory checks `requireAdministratorAuthorization` and answers 404 to anyone else, reads the request's search params with `getSearchParamsRecord` so the export and the page share one pure parser (`parseAdministrationReservationListSearchParams` and `parseAdministrationCustomerListSearchParams`, dropping the page in `parseAdministrationReservationExportSearchParams` and `parseAdministrationCustomerExportSearchParams`), and writes the file with `createCsvDownloadResponse` (`shared/utils/csv.ts`: RFC 4180, a formula guard on text cells, a UTF-8 byte order mark, `private, no-store`). Column definitions (`CsvColumn`) live beside the list, such as `reservation-export.ts` and `customer-export.ts`, and take headers from the area's catalog in the route locale. Format date-times with `formatAdministrationExportDateTime` and amounts with `getAdministrationMoneyAmount`.

- An export never degrades. Its service read (`AdministrationService.exportReservations`, `AdministrationService.exportCustomers`) reuses the list's filter and order building without a limit and passes `failOnProviderFailure` through every Dotypos helper (`loadReservationRangeMap`, `loadReservationDateOrder`, `loadLiveReservations`, `loadCustomers`). A failed Dotypos read fails with `AdministrationListSourceUnavailableError`, which the route answers with 503 and code `administration_list_source_unavailable`, never a partial file. Page reads keep the default `degradeOnProviderFailure`.
- `loadCustomers` reads every customer its batches didn't return through `getCustomer`, under both policies, because a batch can leave out a customer a single read returns. A 404 leaves the customer empty (the row stays, with blank details); any other single-read failure goes through the policy, so an export fails. Under an export a failed batch already failed the read, so only customers that successful batches left out are read singly.
- `exportCustomers` composes the list's `getCustomerListFilter`, `selectCustomerSummaryRows` without paging, and `toCustomerSummaries`, all with `failOnProviderFailure`. A range Dotypos can't answer fails the export (`source: "booking-dates"`) instead of the list's `dateFilterUnavailable`, so the file is never empty or unfiltered by mistake. Its columns are the Dotypos customer ID, name, email, phone, the successful reservation count, last activity, and the localized marketing consent label (`getAdministrationCustomerMarketingConsentLabel`).
- Read bookings and customers by id through `readInIdFilterBatches`, since an export can carry far more ids than one Dotypos filter. In SQL, match an unbounded id list with `equalsAny` (`db/equals-any.ts`), which binds one array parameter; Drizzle's `inArray` binds one parameter per id and fails past Postgres's 65,535-parameter limit.
- The route sets `maxDuration = 300`, because its sequential Dotypos reads can each wait out the 30-second request timeout.
- `AdministrationTableToolbar` takes `exportHref`, a promise of the unprefixed export path, and renders `AdministrationTableExport`. Build the path with `getAdministrationListExportHref(basePath, params)` from the same params object the list passes to its sort links and `Pagination` (`getAdministrationReservationListParams`, `getAdministrationCustomerListParams`). The control downloads through `runWorkspaceBrowserEffect` and accepts only a `text/csv` attachment, because a signed-out request is redirected to the sign-in page, which answers 200 with HTML.

## Reservation author

`AdministrationService.loadReservation` reads `author_account_id` with the reservation and describes it through `ReservationAuthorDirectory` from `@/features/account` (see the domain skill's [reservation parties](../../deskohub-workspace-domain/references/reservation-parties.md)). The detail's `author` is null when `isCustomerOwnAuthor` holds. Otherwise it's `deleted`, `unavailable` (the directory read failed; the page still loads), or an `account` named by the author's own linked Dotypos customer through `loadCustomers`, with the login email. An author without a linked or readable customer gets the unnamed-customer name and `hasName: false`. The API contract declares `author` with a null decoding default, and `dhw reservations get` prints it as a `Booked by:` line.

## Status and lifecycle projection

- `features/administration/reservation-status.ts` projects the local reservation state, payment-attempt state, and fulfillment outcome into Started, Held, Paid, Complete, or the exact cancellation substate.
- A live Dotypos `CANCELLED` booking overlays an attention-state cancellation on a stale local row. List filters and primary badges stay on the local workflow and show the discrepancy as a separate warning. The overlay never writes a transition or authorizes repair.
- Payment failure or expiry alone doesn't mark a held reservation cancelled. An in-progress or failed release never shows as complete.
- Show provider cleanup reasons explicitly: `payment_outcome_unconfirmed_before_cleanup` keeps the hold active for payment review, and `payment_abandoned_after_provider_cutoff` shows a released, abandoned reservation. A failed webhook with `nexi_webhook_late_payment` takes priority over both and shows a refund-required warning without implying fulfillment.
- For a live pending Nexi order, reuse `getProviderOrderAbandonmentState` from `features/checkout/provider-order-abandonment.ts` to distinguish an open window, an overdue empty order, and provider activity that blocks release.
- The schema defines `hold_expired` and `confirming`, but no current writer sets them. Handle both exhaustively and never invent or repair transitions.
- The timeline is an operational reconstruction, not an audit record. Show durable local milestones plus available Nexi and PostHog observations, and never present it as audit-quality history.

## Cancellation and refunds

Operator cancellation is its own guarded workflow, separate from unpaid-hold cleanup. The [checkout skill](../../deskohub-workspace-checkout/SKILL.md) owns the underlying reservation, payment, and late-payment lifecycle.

- It cancels held, confirmed, or retryable `cancellation_failed` reservations. It refuses while fulfillment is `processing` or `awaiting_delivery`, and while payment is pending unless the CLI passes `--force`. A forced cancel atomically cancels the local attempt and releases its discount or voucher claim, and a later provider settlement goes to refund-required recovery without recreating the booking.
- It preserves payment and fulfillment history, marks paid Nexi attempts as refund `required` without issuing a refund, and leaves zero-total internal payments refund-free.
- Igloohome can't revoke AlgoPINs remotely. With a live or ambiguous credential, the operator removes it at the lock and confirms removal (`--confirm-access-credential-removed` in `dhw`). The cancellation claim then retires the local credential atomically.
- Send the customer email only after provider and local cancellation succeed, and report its outcome separately.

The payment-attempt refund state is the single refund work queue, shared with late-payment recovery. Surface it through `RefundAttention` (backed by `countReservationsNeedingRefund`, in its own Suspense boundary on Overview and Reservations) and the `needs_refund` status filter that the API and `dhw` share. Check every attempt, not only the latest. When Nexi reports a refund, the attempt becomes `refunded` and leaves the queue.

Derive every payment summary's status from `getAdministrationPaymentStatus` and render amounts through `PaymentAmount`. Add the "Refund recorded" timeline item from the stored refund only when live Nexi details are unavailable, so a refund never appears twice. Customer revenue sums paid attempts minus recorded refunds.

## Reservation access recovery

- Retry automatically only from `failed`, a definitive provider rejection.
- For `uncertain`, direct the operator to the Igloohome app over Bluetooth at the lock to find the access name the detail view shows and remove it or verify it's absent. Require explicit confirmation before changing `uncertain` to `failed` and retrying. Without confirmation, don't retry; let the possible credential expire.
- Treat a `provisioning` claim older than one minute as ambiguous, with the same workflow. Offer no recovery for a fresh claim.

## Standalone access codes

`/admin/access-codes` is creation-only. Route every surface through `StandaloneAccessCodeAdministration` (`features/access-codes/backend/standalone-access-code-administration.service.ts`).

- Each creation intent has one client-generated attempt ID. The form keeps it across retries of an unchanged window and generates a new one when any field changes.
- The server claims the attempt in an append-only attempt log before calling the provider, so one intent never reaches the provider twice.
- A claim older than `standaloneAccessCodeAttemptStaleAfterMilliseconds` (60 seconds) becomes ambiguous with `standalone_attempt_stale`. A fresh claim reports `in-progress`. The same ID with different input, actor, or source is a mismatch.
- Capacity is per exact device and window: provider variances 2 and 3 allow two live codes. A `rejected` event frees its variance and a `reconciled` event frees its attempt. `created` and `ambiguous` don't.
- Events store safe metadata and outcomes only, never the PIN.
- An `ambiguous` attempt never calls the provider again. End it in the UI and direct the operator to the Igloohome app over Bluetooth.
- While a window has an unreconciled `ambiguous` or stale attempt, refuse new attempts with `cleanup-required` under the device-and-window lock, before any provider call, even with spare capacity. The outcome names the cleanup target.
- With the operator's `providerCredentialRemovedAttemptId` confirmation, append one `reconciled` event for that target (idempotent under concurrency) and claim the new attempt in the same transaction. Another unresolved target produces another `cleanup-required` outcome.
- Replaying a reconciled attempt's own ID without confirmation still reports `ambiguous`. With confirmation it records the reconciliation and returns `reconciled`, so the client can issue a fresh attempt.

## Customer list

- `parseAdministrationCustomerListSearchParams` (`page-data.server.ts`) is the pure parser for `/admin/customers` URLs; the page loader authorizes first, and any other route over the list reuses it. It reads `from`, `to`, `marketingConsent`, `sort`, `direction`, and `page`, normalizes dates through `getAdministrationReservationDateRange`, and applies no default range.
- `getAdministrationCustomerListParams` (`customer-list-filters.ts`) builds the one normalized params object (no page) that the filter form's shortcuts, sort links, and pagination carry. Add a new customer filter there and in the parser, not per link.
- `AdministrationService.listCustomers` applies one filter (`getCustomerListFilter`) to the count and the grouped rows (`selectCustomerSummaryRows`). The date filter loads the Dotypos range with `loadReservationRangeMap` and keeps customers with a `successfulReservationCondition` row among those bookings that Dotypos hasn't `CANCELLED`, by stored `dotyposCustomerId`; the range read already carries each booking's status, so no extra read is needed. It filters customers, not rows, so the aggregates stay full-history. An unavailable range selects nothing and sets `dateFilterUnavailable`.
- `customerMarketingConsentState` derives `granted`, `withdrawn`, or `never` from `customer_marketing_consents`; the filter and the list item's `marketingConsent` share it. Consent is kind-specific: another consent kind gets its own param and select.

## Customer and overview metrics

- Customer detail bounds provider enrichment and visible history to the 24 most recently updated reservations, and the transaction table to the latest 50 payment attempts. Link to the filtered reservation index when more exist. Count, revenue, savings, and favourite product stay database aggregates over the full local history.
- The 365-day customer chart, Overview completed counts, and Overview customers share one qualifying rule: `getAdministrationReservationStatus(row).group === "complete"` and live Dotypos status `CONFIRMED`, counted on the Dotypos start date. Never add an elapsed-time or end-date condition, because fulfillment can precede the booking.
- The Overview total (`value` in `getAdministrationReservationOverview`) is a separate count of every linked reservation, including new and cancelled ones. Don't apply the completed rule to it.
- Overview counts each customer once by the live booking's `_customerId`, falling back to the stored Workspace customer ID. New customers are the subset whose Dotypos `created` timestamp falls in the range.

## Invoices

Keep customer resolution and issuance in the shared invoice administration service so the UI and API enforce the same exact-email reuse, billing update, currency, idempotency, provenance, and delivery rules.

- Claim an ad-hoc invoice's client UUID before any Dotypos mutation. Bind the normalized request and server-derived provenance with a keyed digest, and store no plaintext customer data in the claim.
- Reject a different request for the same UUID. Let the identical request reclaim an incomplete claim after one minute.
- An explicit list sort drops the delivery-attention grouping.
- Keep payment status and email delivery status separate. Fresh `processing` delivery displays as sending, not sent.

## PostHog history

History enrichment runs only when `POSTHOG_API_HOST`, `POSTHOG_PROJECT_ID`, and `POSTHOG_API_KEY` are all set. The personal API key needs `feature_flag:read`, `error_tracking:write`, and `query:read`. Never use the public ingest token.

`features/administration/posthog-reservation-history.ts` limits queries to the app's reservation lifecycle event names, the reservation ID, the current environment, and the Workspace service name. It decodes only event name, time, event ID, payment-attempt ID, and provider. React never receives the raw event. If PostHog is unconfigured, slow, or undecodable, the page shows durable milestones only.
