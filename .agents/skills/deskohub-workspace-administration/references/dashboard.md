# Administration dashboard

The dashboard lives in `apps/deskohub-workspace/app/[locale]/admin` and `features/administration`. The [administration specification](../../../../apps/deskohub-workspace/docs/administration-dashboard.md) defines navigation, operator-visible statuses, metric definitions, and invoice presentation. This reference covers how to implement them.

## Rendering

- Keep the layout, brand, navigation, and page frame in the static shell. The admin layout doesn't call `connection()` or await request or provider data. Put route-dependent client hooks, such as `usePathname()`, behind their own narrow Suspense boundary.
- Keep identity controls, such as logout or an avatar, out of the shell. Request-derived identity stays inside each page's authorization and Suspense boundaries.
- Start data promises without awaiting them, render stable page controls immediately, and pass each promise to the smallest async Server Component that needs it. Wrap each delayed count, filter set, collection, detail panel, or modal in a layout-matched fallback. Route-level `loading.tsx` files are only the navigation safety net.
- Run every Admin UI page query through `runAdministrationPage(operation, query, capabilities)` and define every operator Server Action with `defineAdministrationAction`, both in `features/administrators/server/administration-request.server.ts`. Don't call the guards in `administrator-authorization.server.ts` from a feature; only the edge and the list export route use them.
  - Both read the Better Auth session and the `administrator` grant from the database on every request; never cache the result past the request. The page gate is wrapped in React `cache()`, so a page's streamed loaders share one check per request. It sends a signed-out visitor to sign-in with `returnTo` (the path the proxy forwards in `x-deskohub-administration-path`) and answers a signed-in account without the grant with `notFound()`.
  - The page runner provides the query's capabilities over `CurrentAdministrator` and runs at the `route` boundary. A query fails with `AdministrationRecordNotFound` to answer 404; route identifiers decode inside the query (`route-identifiers.server.ts`) so a signed-out visitor still reaches sign-in first. Pass `Layer.empty` when a guarded loader needs no capability.
  - The action edge fails closed before the handler or its capabilities start, with `AdministratorUnauthorizedError` and never a redirect, so a Server Action can't loop through sign-in. The handler reads the actor from `CurrentAdministrator`; take provenance from it, never from input. `publicFailure` words failures, including the refusal; `unauthorizedResult` answers a client that reads refusals as data, as campaign operations do. List the changed pages in `revalidates` with `administrationHref`: the edge revalidates them after the action settles, outside its fiber, because a fiber resumed by a database callback can run under another request's Next.js work store, where `revalidatePath` throws.
  - Use `refreshes(input, result)` for best-effort cache maintenance beyond the page list, such as calendar discount tag invalidation and `after()` priming. It runs synchronously only after a successful action settles and outside the action fiber; a throw is logged without failing the action, so callers must never invalidate tags or schedule `after()` inside the handler.
  - In tests, substitute the session and grant with `mockAdministratorAccess` (`administrator-access.test-utils.ts`) instead of mocking the guards, so loaders and actions run through the real edge.
- Parallelize independent reads, and never persistently cache live operator data. Load only the projection a page displays. For example, Codes doesn't wait for Calendar sales, and breadcrumbs use static labels or narrow label loaders, not full detail loaders.
- Declare each admin area once in `features/administration/administration-areas.ts`: its collection label and `administrationHref`, its record label, and the pages under both, such as `new`. The breadcrumb trail and the shell navigation read it. Give each new page an `@breadcrumb` slot page (`administration-areas.test.ts` fails on an undeclared slot); a record whose crumb shows its own name gets a narrow label loader, run through `runAdministrationPage`, in `recordLabelLoaders` (`breadcrumb.server.tsx`, which the `no-heavy-breadcrumb-imports` lint guards).
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

## List queries

Each list's URL query has one module built with `defineAdministrationListQuery` (`features/administration/list-query.ts`): `reservationListQuery`, `customerListQuery`, `bookingListQuery`, `orderListQuery` and `operationListQuery` beside their lists in `features/administration` (`*-list-query.ts`), and `invoiceListQuery` in `features/accounting/admin`. Orders and operations normalize through `payment-administration-filters.ts`, which the CLI handlers share. It owns the param names, the literal sets (taken from the `@deskohub/workspace-admin-api` schemas where the contract has them), the defaults, page parsing and the list's normalization, and decodes through `getSearchParamsDecoder`. Every param decodes on its own, so an invalid value falls back like an absent one. A repeated param reads as its first value, except on the invoice list (`repeatedParams: "absent"`), which reads it as absent. `dhw` validates the same literals strictly through the contract.

- `parse` reads the page's or export route's search params, and the page loader passes the result to the service as the list input.
- `href(query, { page })` builds the list URL for sort links, filter shortcuts, "clear" links and `Pagination` (`href={(page) => listQuery.href(query, { page })}`). Params come in the order the list declares them, with `page` last and only past the first page. Reservations and customers declare theirs alphabetically, bookings `date, direction, sort`, invoices `sort, direction`; keep a list's existing order when adding a param, so its links don't change.
- `exportHref` and `parseExport` give the CSV export the list's filters and order without the page.
- `tableSorting(query)` spreads into `AdministrationDataTable` as `sorting` and `getSortHref`; client tables take the query and call it themselves. Header links name `sort` and `direction` in their declared place; the booking list (`sortLinkOrder: "afterFilters"`) names them after its other params.
- `formSchema` (Standard Schema V1, for `standardSchemaResolver`) and `formValues(query)` back the list's filter form.

Add a new filter to the list's query module, not to a link or form. Test it at the module: `parse(href(query))` round-trips plus default and normalization cases, in the colocated `*-list-query.test.ts`.

## Reservation list

`reservationListQuery` applies the default date range with `getAdministrationReservationListDateRange`: from January 1 of the current Prague year, with no upper bound. The parsed query carries the effective range, so date controls, sort links, and pagination carry it. A `customerId` list and the `needs_refund` queue get no default range, and the legacy `date` param still reads as a one-day range. Keep the default in the UI query. `AdministrationService.listReservations` and `dhw reservations list` treat an absent range as unbounded.

A meeting room booked with early setup is held in Dotypos from its setup start. `toReservationSummary` decodes the booking with the row's stored details (`decodeBookedReservation`), so `startsAt` and `date` are the booked start and `setupStartsAt` is the held start; every other reservation keeps Dotypos's values and a null `setupStartsAt`. Booking summaries and the booking breadcrumb show the booked start too (`getBookedStartsAt`, `reservation-booked-date.ts`). The contract declares `setupStartsAt` with a null decoding default; the table, related reservation cards, detail, CSV export, and `dhw reservations get` show it only when set. Date filters (`loadReservationRangeMap`, behind the reservation and customer lists, exports, and the detail's same-date list) match the booked date: they read Dotypos from the setup lead time before the range (`getAdministrationReservationHeldRangeBounds`) and read stored details only for bookings that early setup would hold from the previous date (`reservation-booked-date.ts`), such as a midnight start. The date sort orders by booked start: it re-sorts Dotypos's start order (`orderByBookedStart`), reading stored details only for neighbouring bookings that start within the setup lead of each other (`getEarlySetupOrderCandidates`). The Bookings list reads its date the same way, loads the early-setup details of the day's bookings in one query, and sorts by booked start. Overview counts, Overview customers, and both activity charts count on the booked date too: `listLinkedBookings` reads with the held bounds and loads the early-setup details of the bookings it lists in one query (`loadEarlySetupDetails`, `features/reservation/backend/early-setup-details.ts`); the customer chart uses the details its linked rows already carry.

## List export

A list's CSV export is a GET route beside its page, `app/[locale]/admin/<list>/export/route.ts`, built with `defineAdministrationListExportRoute` (`features/administration/list-export.server.ts`). The factory checks `requireAdministratorAuthorization` itself, because a route answers through `WorkspaceRouteFailure`, and answers 404 to anyone else, reads the request's search params with `getSearchParamsRecord` so the export and the page share one pure parser (the list query's `parseExport`, which drops the page), and writes the file with `createCsvDownloadResponse` (`shared/utils/csv.ts`: RFC 4180, a formula guard on text cells, a UTF-8 byte order mark, `private, no-store`). Column definitions (`CsvColumn`) live beside the list, such as `reservation-export.ts` and `customer-export.ts`, and take headers from the area's catalog in the route locale. Format date-times with `formatAdministrationExportDateTime` and amounts with `moneyMajorAmount` (`shared/money/money.ts`).

- An export never degrades. Its service read (`AdministrationService.exportReservations`, `AdministrationService.exportCustomers`) reuses the list's filter and order building without a limit and passes `failOnProviderFailure` through every Dotypos helper (`loadReservationRangeMap`, `loadReservationDateOrder`, `loadLiveReservations`, `loadCustomers`). A failed Dotypos read fails with `AdministrationListSourceUnavailableError`, which the route answers with 503 and code `administration_list_source_unavailable`, never a partial file. Page reads keep the default `degradeOnProviderFailure`.
- `loadCustomers` reads every customer its batches didn't return through `getCustomer`, under both policies, because a batch can leave out a customer a single read returns. A 404 leaves the customer empty (the row stays, with blank details); any other single-read failure goes through the policy, so an export fails. Under an export a failed batch already failed the read, so only customers that successful batches left out are read singly.
- `exportCustomers` composes the list's `getCustomerListFilter`, `selectCustomerSummaryRows` without paging, and `toCustomerSummaries`, all with `failOnProviderFailure`. A range Dotypos can't answer fails the export (`source: "booking-dates"`) instead of the list's `dateFilterUnavailable`, so the file is never empty or unfiltered by mistake. Its columns are the Dotypos customer ID, name, email, phone, the successful reservation count, last activity, and the localized marketing consent label (`getAdministrationCustomerMarketingConsentLabel`).
- Read bookings and customers by id through `getReservationsByIds` and `getCustomersByIds`, since an export can carry far more ids than one Dotypos filter. In SQL, match an unbounded id list with `equalsAny` (`db/equals-any.ts`), which binds one array parameter; Drizzle's `inArray` binds one parameter per id and fails past Postgres's 65,535-parameter limit.
- The route sets `maxDuration = 300`, because its sequential Dotypos reads can each wait out the 30-second request timeout.
- `AdministrationTableToolbar` takes `exportHref`, a promise of the unprefixed export path, and renders `AdministrationTableExport`. Build it with the list query's `exportHref`, so it keeps the filters and order the list's sort links and `Pagination` carry. The control downloads through `runWorkspaceBrowserEffect` and accepts only a `text/csv` attachment, because a signed-out request is redirected to the sign-in page, which answers 200 with HTML.

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

- `customerListQuery` (`customer-list-query.ts`) is the `/admin/customers` URL query; the page loader authorizes first, and the export route reuses it. It reads `from`, `to`, `marketingConsent`, `sort`, `direction`, and `page`, normalizes dates through `getAdministrationReservationDateRange`, and applies no default range. It owns the consent filter's order and URL decoding; the states themselves are legal's `MarketingConsentStatus`.
- `AdministrationService.listCustomers` applies one filter (`getCustomerListFilter`) to the count and the grouped rows (`selectCustomerSummaryRows`). The date filter loads the Dotypos range with `loadReservationRangeMap` and keeps customers with a `successfulReservationCondition` row among those bookings that Dotypos hasn't `CANCELLED`, by stored `dotyposCustomerId`; the range read already carries each booking's status, so no extra read is needed. It filters customers, not rows, so the aggregates stay full-history. An unavailable range selects nothing and sets `dateFilterUnavailable`.
- `customerMarketingConsentState` is legal's `marketingConsentState` over the reservation's customer: `active`, `withdrawn`, or `absent` (`MarketingConsentStatus`); the filter and the list item's `marketingConsent` share it. The `marketingConsent` URL param also decodes the earlier `granted` and `never` to `active` and `absent`, so old links filter the same customers; links write the current values. Consent is kind-specific: another consent kind gets its own param and select.

## Customer and overview metrics

- Customer detail bounds provider enrichment and visible history to the 24 most recently updated reservations, and the transaction table to the latest 50 payment attempts. Link to the filtered reservation index when more exist. Count, revenue, savings, and favourite product stay database aggregates over the full local history.
- The 365-day customer chart, Overview completed counts, and Overview customers share one qualifying rule: `getAdministrationReservationStatus(row).group === "complete"` and live Dotypos status `CONFIRMED`, counted on the booked date, which is the Dotypos start date except for early-setup meeting rooms. Never add an elapsed-time or end-date condition, because fulfillment can precede the booking.
- The Overview total (`value` in `getAdministrationReservationOverview`) is a separate count of every linked reservation, including new and cancelled ones. Don't apply the completed rule to it.
- The Overview reservation activity chart (`AdministrationService.loadReservationActivity`) counts like the Overview total: every live booking in the 365-day range whose ID a Workspace row links. It reads the linked IDs from the database first, then only those bookings from Dotypos through `getReservationsByIds` with the range filter. Never list the whole range from Dotypos: the shared preview cloud holds hundreds of pages per year, and that scan kept the Overview stream open past the E2E navigation timeout. It shares `ReservationActivityCalendar` (`features/administration/reservation-activity-calendar.tsx`) with the customer chart; the customer chart picks a color per category, the Overview chart shades by count with `getReservationActivityIntensity`.
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
