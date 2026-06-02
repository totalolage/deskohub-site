---
status: not-started
phase: 1
updated: 2026-06-01
---

# Implementation Plan

## Goal
Create workspace Dotypos reservations in `NEW` state when the reservation form is submitted, then confirm the same reservation after successful payment at the current post-payment fulfillment point.

## Context & Decisions
| Decision | Rationale | Source |
|----------|-----------|--------|
| Use Dotypos `NEW` as the unconfirmed reservation state | Generated Dotypos reservation types allow `NEW`, `CONFIRMED`, and `CANCELLED`; there is no separate `UNCONFIRMED` literal. | `ref:tory-black-boar` |
| Confirm the pre-created reservation inside paid fulfillment | The current confirmed reservation creation point is `WorkspacePaidFulfillmentService.ensureReservation`, after successful Nexi payment and fulfillment claim. | `ref:tory-black-boar` |
| Do not introduce a draft or intent table | Product decision: use the existing order/payment persistence path instead of a separate pre-payment intent model. | user decision |
| Create the local `payment_orders` row during reservation submit | Without a draft table, the existing payment order becomes the durable mapping between generated `orderId`, Dotypos customer, Dotypos reservation, quote, legal evidence, and later payment state. | `ref:tory-black-boar` |
| Store legal evidence as a map keyed by legal document hash | The document hash is the identifier for the exact legal document accepted or rejected. This supports partial fill and durable proof of explicit false values. | user decision |
| Allow legal evidence records with `accepted: false` | Business logic should reject false consent where required, but storing a false value preserves what was actually submitted and can prove non-consent. | user decision |
| Keep `source` as a free string on legal evidence | A string source can identify the boundary that collected evidence, such as reservation submit or payment submit, without needing a rigid enum migration for every source. | user decision |
| Split privacy policy and payment terms collection | Privacy evidence is required before creating the Dotypos customer/reservation on form submit; payment terms evidence is required before starting the hosted payment page. | user decision |
| Preserve customer contact ownership in Dotypos, not local checkout JSON | Existing checkout details intentionally avoid storing name, email, phone, and message locally; early reservation should keep that pattern unless deliberately changed. | `ref:tory-black-boar` |
| Keep a paid-fulfillment fallback for paid orders without `dotyposReservationId` | Existing in-flight or legacy orders may reach fulfillment without a pre-created reservation; preserving confirmed creation avoids failing paid customers during rollout. | `ref:realistic-amber-ostrich` |
| Treat terminal payment failure/cancellation/expiry as cancellation of the pre-created `NEW` reservation | This prevents abandoned unpaid reservations from remaining active in Dotypos; retry after cancellation must create a replacement `NEW` reservation or explicitly fail into a new order flow. | `ref:realistic-amber-ostrich` |
| Use canonical string constants for legal evidence source values | `source` remains a string for storage flexibility, but constants avoid typo-driven audit fragmentation. | `ref:realistic-amber-ostrich` |
| Add an append-only legal evidence audit sink for rejected pre-order consent submissions | Privacy `accepted: false` must be storable even when business logic blocks order creation; this is not a reservation draft/intent because it cannot drive checkout or reservation recovery. | `ref:disciplinary-violet-gayal` |
| Use the customer-plus-reservation combo as the reservation-submit idempotency key | Product decision: duplicate or concurrent submits for the same customer/reservation tuple must resolve to the same early order/reservation instead of creating multiple Dotypos `NEW` reservations. | user decision |
| Claim reservation creation locally before calling Dotypos | A `none -> creating` compare-and-set prevents concurrent requests with the same idempotency key from creating multiple remote `NEW` reservations. | `ref:constitutional-coral-stingray` |
| Enforce duplicate reservation prevention in the app, not Dotypos | Manual API testing showed Dotypos allows the same customer to hold multiple concurrent `NEW` reservations for the same table and time window. | manual Dotypos API test |
| Treat the Nexi HPP link expiry as provider-managed and not configurable by current code | The app sends no expiry, valid-until, or session TTL field to `/orders/hpp`; local pay-state and checkout return-state tokens are both 10 minutes, but provider HPP lifetime is not explicit in the generated schema or service. | `ref:sufficient-coffee-lemur` |
| Use an app-owned reservation hold expiry for pre-payment `NEW` reservations | Because provider HPP expiry is not explicit, stale `NEW` cancellation should rely on a local `reservationHoldExpiresAt` derived from a configured hold TTL, initially aligned with the 10-minute local checkout token TTL unless business chooses a different hold window. | `ref:sufficient-coffee-lemur` |
| Store reservation hold expiry locally, not in Dotypos | Dotypos reservation create/update/read types expose start/end dates, status, note, created, and version date, but no hold-expiry field; the app-owned expiry must live on the local order row. | user decision |
| Cancel stale unpaid `NEW` reservations from a domain cleanup service, not repository side effects | Cancellation requires Dotypos I/O; repository methods should expose lifecycle CAS transitions while webhook/status/cron orchestration calls the cancellation service. | `ref:sufficient-coffee-lemur` |
| Use Vercel Cron for the scheduled stale-hold sweep | Vercel Cron supports static recurring schedules rather than per-reservation one-time jobs; a recurring sweeper should query all expired holds by `reservationHoldExpiresAt` and catch up if a run is delayed. | user decision |
| Run bounded cleanup before workspace availability reads Dotypos reservations | `WorkspaceAvailabilityService` loads Dotypos reservations before calculating availability, and availability already treats `NEW` as occupied while ignoring `CANCELLED`; cleanup before that read makes availability fresher while keeping cron as the primary cleanup path. | user decision |
| Do not treat hold expiry alone as final payment failure while a Nexi session may still pay | Since Nexi HPP can still report success after the app cancels the hold, payment reconciliation must remain able to mark the order paid and then compensate/refund if fulfillment cannot recover. | `ref:sufficient-coffee-lemur` |
| Add Nexi refund compensation for paid orders that cannot be fulfilled into a confirmed reservation | Current code leaves paid orders as fulfillment failed with no refund; the stale-cancelled-while-paying race needs a refund path when replacement confirmed reservation creation or confirmation fails. | `ref:unwilling-amaranth-worm` |
| Persist the actual successful Nexi operation ID for refunds | The refund endpoint requires an operation ID, while current metadata stores the provider order ID in `lastProviderOperationId`; verification must retain the executed `AUTHORIZATION` or `CAPTURE` operation ID separately. | `ref:unwilling-amaranth-worm` |
| Persist and reuse one provider refund idempotency key per refund attempt | A new idempotency key per retry or duplicate webhook could issue duplicate refunds; the key must be generated when the local refund attempt is claimed, saved before the provider call, and reused for that attempt. | `ref:grieving-crimson-hoverfly` |

## Phase 1: Schema And Legal Model [IN PROGRESS]
- [ ] **1.1 Define legal document key/hash constants and evidence shape** ← CURRENT
- [ ] 1.2 Replace single final-submit legal evidence shape with a document-hash keyed map
- [ ] 1.3 Require each map key to equal the evidence record's `documentHash` at parse boundaries
- [ ] 1.4 Update checkout details schema/types to support partial legal evidence maps and preserve `accepted: false`
- [ ] 1.5 Add privacy policy and payment terms hash configuration/constants
- [ ] 1.6 Add canonical source string constants such as `reservation_submit` and `payment_submit`
- [ ] 1.7 Inspect current DB JSON constraints and generated schemas, then either add a migration or record why no migration is needed
- [ ] 1.8 Define legal evidence merge rules: merge by document hash, reject accidental mismatches, and do not silently overwrite existing evidence unless replacing that same document hash with a newer submitted record
- [ ] 1.9 Require source values at parse/construction boundaries and ensure new evidence construction uses canonical constants
- [ ] 1.10 Add or identify an append-only audit sink for rejected pre-order legal evidence, with nullable `orderId`, `idempotencyKey`, `documentHash`, `accepted`, `acceptedAt`, and `source`
- [ ] 1.11 Define audit sink deduplication for repeated rejected submissions with the same `idempotencyKey` and `documentHash`, preserving append-only history or an explicit unique conflict policy
- [ ] 1.12 Define an operational recovery sink for remote reservation success followed by local attach/cancel failure, with `orderId`, `reservationSubmitKey`, `dotyposCustomerId`, `dotyposReservationId`, attempted cancellation result, timestamps, and failure reason
- [ ] 1.13 Update tests for legal evidence parsing, partial maps, key/hash mismatches, source handling, merge collisions, rejected evidence audit behavior, and `accepted: false`

## Phase 2: Persistence Shape And Idempotency [PENDING]
- [ ] 2.1 Define `reservationSubmitKey` as a deterministic server-derived digest/HMAC of the customer-plus-reservation tuple, not a random client-generated token or raw serialized tuple
- [ ] 2.2 Canonicalize the tuple from normalized customer identity and reservation details before side effects, then store only the non-reversible digest/HMAC; include enough reservation dimensions to represent the business duplicate boundary, such as date, entry tier, coffee, monitor option, and table/location scope if relevant
- [ ] 2.3 Add a non-null `reservationSubmitKey` field to the early order persistence model
- [ ] 2.4 Add a unique index for `reservationSubmitKey`, scoped globally for workspace orders unless implementation discovers a required tenant/location scope
- [ ] 2.5 Do not return another user's order/pay redirect on tuple collision unless the request matches the same normalized customer identity and reservation details; treat mismatches as conflicts without leaking order details
- [ ] 2.6 Define local reservation lifecycle enum/states before dependent phases: `none`, `creating`, `NEW`, `cancellation_pending`, `CANCELLED`, and `CONFIRMED`
- [ ] 2.7 Add local reservation lifecycle fields before checkout/fulfillment refactors, such as `dotyposReservationStatus`, `reservationCreatedAt`, `reservationConfirmedAt`, and `reservationCancelledAt`
- [ ] 2.8 Inspect current DB constraints, indexes, generated schemas, and repository assumptions for required migration changes covering legal JSON, idempotency, and reservation lifecycle fields
- [ ] 2.9 Add repository lookup by idempotency key that returns the existing order, Dotypos customer ID, Dotypos reservation ID/status, and pay-state-relevant details only after tuple/context validation
- [ ] 2.10 Add repository transition to claim reservation creation with compare-and-set `none -> creating`
- [ ] 2.11 Add repository transitions for `creating -> NEW`, `creating -> none` on remote-create failure before success, `NEW -> cancellation_pending`, `cancellation_pending -> CANCELLED`, and `NEW -> CONFIRMED`
- [ ] 2.12 Add tests for tuple canonicalization, idempotency uniqueness, collision privacy, duplicate lookup, lifecycle marker parsing, lifecycle CAS transitions, and migration-compatible defaults
- [ ] 2.13 Add configured reservation hold TTL and persisted local `payment_orders` markers for pre-payment `NEW` holds: `reservationHoldExpiresAt` as the app-owned deadline and `reservationHoldExpiredAt` when cleanup observes/cancels the expired hold
- [ ] 2.14 Add cancellation failure/recovery metadata for `cancellation_pending` holds so failed Dotypos cancellations are retryable and auditable
- [ ] 2.15 Add refund lifecycle persistence, either as explicit `payment_orders` refund fields or a `payment_refund_attempts` table with status, reason, amount, currency, provider idempotency key, original successful payment operation ID, provider refund operation/result ID, provider refund status, timestamps, and failure details
- [ ] 2.16 Store Nexi provider order ID separately from the actual successful payment operation ID required for refunds
- [ ] 2.17 Add tests for hold expiry marker parsing, stale-hold selection indexes, refund lifecycle state transitions, and provider identifier persistence

## Phase 3: Form Consent Wiring [PENDING]
- [ ] 3.1 Add privacy policy consent UI to `ReservationForm`
- [ ] 3.2 Ensure all customer and reservation fields needed to derive the server-side idempotency tuple are present in the reservation submit payload
- [ ] 3.3 Include privacy policy evidence keyed by document hash in the reservation submit payload
- [ ] 3.4 Prevent client-side submit unless privacy policy evidence is present, while still relying on server-side enforcement for correctness
- [ ] 3.5 Update payment page checkbox copy to refer only to payment terms/T&Cs before server-side hosted checkout enforcement relies on that distinction
- [ ] 3.6 Ensure desktop and mobile layouts remain usable after adding the reservation-form privacy checkbox
- [ ] 3.7 Add UI/action input tests for privacy evidence and tuple-derived idempotency inputs

## Phase 4: Early Payment Order Creation [PENDING]
- [ ] 4.1 Refactor checkout detail construction so reservation-submit can build an initial checkout details object with privacy evidence only
- [ ] 4.2 Add repository support for creating a pre-payment order before hosted checkout creation using customer-plus-reservation `reservationSubmitKey` idempotency
- [ ] 4.3 Add repository support for claiming reservation creation with compare-and-set `none -> creating` before any Dotypos create call
- [ ] 4.4 Add repository support for merging later payment terms evidence into existing checkout details using the Phase 1 merge rules
- [ ] 4.5 Add repository support for attaching a Dotypos reservation to a non-paid order only from lifecycle `creating`, setting `dotyposReservationId`, `reservationCreatedAt`, and lifecycle `NEW`
- [ ] 4.6 Ensure early order creation stores `paymentStatus: "created"`, `fulfillmentStatus: "not_started"`, and lifecycle status `none`
- [ ] 4.7 Preserve existing fulfillment access code policy initialization when creating the early order
- [ ] 4.8 Define retry behavior for local orders with `dotyposCustomerId` but no `dotyposReservationId`: duplicate submit with the same customer-plus-reservation tuple claims `none -> creating` and retries reservation creation if quote is still fresh, otherwise returns pricing/expired restart response without starting payment
- [ ] 4.9 Define behavior for duplicate requests that see lifecycle `creating`: wait/reload briefly or return an in-progress response, but never call Dotypos create from the second request
- [ ] 4.10 Define partial-creation compensation for Dotypos reservation creation failure before remote success: transition `creating -> none`, keep `paymentStatus: "created"`, and surface a non-payment-starting error instead of sealing pay state
- [ ] 4.11 Add tests for early order creation, retry-safe missing reservation state, quote freshness on retry, concurrent `creating` claim behavior, and legal evidence merging

## Phase 5: Reservation Submit Side Effects [PENDING]
- [ ] 5.1 Extend reservation submit schema to accept privacy policy evidence keyed by document hash and all fields needed to derive the required customer-plus-reservation idempotency key
- [ ] 5.2 Parse privacy evidence and require the configured privacy policy hash with `accepted: true` before any order/reservation side effect
- [ ] 5.3 If submitted privacy evidence has `accepted: false`, record it only in the append-only legal evidence audit sink and return a validation error without creating an order, customer, reservation, or pay state
- [ ] 5.4 Clarify ordering: pure ID generation and quote calculation may happen before consent checks, but no payment-order write or external Dotypos mutation may occur before accepted privacy evidence is parsed
- [ ] 5.5 Derive the customer-plus-reservation idempotency key before mutation and use that lookup first; if it already has an attached active `NEW` reservation and tuple/context validation passes, return the existing order/pay redirect instead of creating another Dotypos reservation
- [ ] 5.6 Generate `orderId` before side effects for new idempotency keys and use it consistently for payment order, pay state, and Dotypos reservation note
- [ ] 5.7 Build authoritative quote before creating the local order
- [ ] 5.8 Create or find Dotypos customer from reservation contact fields
- [ ] 5.9 Create local `payment_orders` row with Dotypos customer, initial checkout details, created payment status, idempotency key, and lifecycle status for no reservation yet
- [ ] 5.10 Claim reservation creation locally with CAS `none -> creating`; if another request already holds `creating`, wait/reload or return in-progress without calling Dotypos create
- [ ] 5.11 Create Dotypos reservation with status `NEW` only after this request owns the local `creating` claim
- [ ] 5.12 Attach `dotyposReservationId`, `reservationCreatedAt`, and local lifecycle status `NEW` using a guarded `creating -> NEW` attach
- [ ] 5.13 If Dotypos `NEW` creation succeeds but local attach fails, immediately cancel the remote reservation; persist an operational recovery record with `orderId`, `reservationSubmitKey`, `dotyposCustomerId`, `dotyposReservationId`, attempted cancellation result, timestamps, and failure reason before returning failure
- [ ] 5.14 Seal pay state using the same `orderId` and redirect to checkout pay only after successful local attachment
- [ ] 5.15 Add tests proving duplicate/concurrent submits for the same customer-plus-reservation tuple return the same `orderId`/reservation and do not create multiple `NEW` reservations
- [ ] 5.16 Add tests proving second requests that observe `creating` never call Dotypos create
- [ ] 5.17 Add tests covering attach failure after remote reservation success and the concrete cancellation/recovery record behavior
- [ ] 5.18 Add tests proving form submit creates one `NEW` reservation and persists the returned ID

## Phase 6: Payment Page Terms Consent [PENDING]
- [ ] 6.1 Rename or replace ambiguous `legalConsent` input with payment terms evidence
- [ ] 6.2 Require the configured payment terms/T&Cs hash with `accepted: true` before hosted checkout creation
- [ ] 6.3 Store payment terms evidence by document hash with accepted value, submitted timestamp, document hash, and source
- [ ] 6.4 Persist submitted `accepted: false` evidence to checkout details when an order exists, or to the audit sink if no order can be opened, but fail before starting the hosted payment side effect
- [ ] 6.5 Update `CheckoutPayPage` checkbox wiring to distinguish payment terms from privacy policy
- [ ] 6.6 Update server action input tests to verify payment terms evidence handling and false-value rejection

## Phase 7: Failure, Cancellation, And Retry State Machine [PENDING]
- [ ] 7.1 Consume the Phase 2 lifecycle transitions for payment failure/cancellation: `NEW -> cancellation_pending -> CANCELLED`
- [ ] 7.2 Define terminal unsuccessful payment behavior as cancellation of active `NEW` reservations
- [ ] 7.3 Define retry state machine: active `NEW` can be reused before cancellation terminalization; cancelled reservation needs replacement `NEW` or new order; confirmed reservation cannot be retried as unpaid
- [ ] 7.4 Ensure terminalization first claims `NEW -> cancellation_pending`; hosted checkout retry must reject or wait while status is `cancellation_pending`
- [ ] 7.5 Add Dotypos cancellation/update support for terminal unsuccessful payments
- [ ] 7.6 Wire cancellation into `markFailed`, `markCancelled`, and `markExpired` flows or the webhook service after terminal status changes
- [ ] 7.7 Ensure cancellation transitions `cancellation_pending -> CANCELLED` after remote cancellation succeeds, and leaves recoverable `cancellation_pending` state with failure metadata if remote cancellation fails
- [ ] 7.8 Add tests for payment failure, cancellation, expiry, retry-before-cancel, retry-after-cancel, and confirmed-order retry rejection
- [ ] 7.9 Define `reservationHoldExpiresAt` as the local app-owned stale `NEW` deadline on `payment_orders`; do not depend on Nexi HPP provider expiry or Dotypos fields because neither exposes an explicit reservation-hold expiry for this flow
- [ ] 7.10 Add a reservation hold cleanup service that selects unpaid active `NEW` orders past `reservationHoldExpiresAt`, claims `NEW -> cancellation_pending`, calls Dotypos cancellation, and marks `CANCELLED` with `reservationCancelledAt`/`reservationHoldExpiredAt`
- [ ] 7.11 Add a Vercel Cron-backed workspace cleanup route/job for stale `NEW` holds; the workspace app currently has no cron route, so implementation must add a protected route and recurring cron configuration rather than relying on per-reservation one-time schedules
- [ ] 7.12 Add bounded best-effort cleanup before `WorkspaceAvailabilityService.loadInventory` calls `dotypos.listReservations()`, so public availability and `ensureAvailable` calculations do not continue treating locally expired holds as occupied when they can be cancelled first
- [ ] 7.13 Add opportunistic cleanup calls at other safe orchestration boundaries such as reservation-submit idempotency lookup, hosted checkout creation, checkout status/provider return, and webhook failure handling
- [ ] 7.14 Ensure cleanup-on-query has a small batch limit, timeout, CAS-based duplicate protection, and failure logging; if cleanup fails or times out, availability should continue conservatively rather than fail the user-facing availability request
- [ ] 7.15 For `payment_pending` orders, cancel the expired reservation hold but keep payment reconciliation capable of accepting a later verified Nexi success; do not mark payment terminal solely because the reservation hold expired
- [ ] 7.16 For `created` orders with no Nexi session, allow cleanup to mark the payment side expired after reservation cancellation because no provider payment can arrive
- [ ] 7.17 Explicitly allow late provider reconciliation to transition `payment_pending` plus reservation lifecycle `CANCELLED` into `paid` plus fulfillment replacement/compensation flow, rather than rejecting the payment because the hold expired
- [ ] 7.18 Add tests for Vercel Cron route authorization/scheduling integration, scheduled cleanup selection, cleanup-before-availability-query behavior, opportunistic cleanup, duplicate cleanup idempotency, cancellation failure recovery, payment-pending late-success reconciliation, late-success `payment_pending` plus `CANCELLED` lifecycle transition, and created-without-session expiry

## Phase 8: Hosted Checkout Refactor [PENDING]
- [ ] 8.1 Change `CheckoutService.createHostedPaymentCheckout` to require an existing early payment order by `orderId`
- [ ] 8.2 Remove new-order Dotypos customer creation from final payment submit path for the early-reservation flow
- [ ] 8.3 Require local reservation lifecycle status `NEW` before starting a new Nexi hosted payment session
- [ ] 8.4 Recalculate quote and compare against pay state before starting Nexi session
- [ ] 8.5 If pricing changed, return pricing-changed response without creating another Dotypos reservation
- [ ] 8.6 Merge payment terms evidence into existing checkout details only after terms evidence passes validation and using the Phase 1 collision rules
- [ ] 8.7 Start Nexi hosted payment session using the existing payment order
- [ ] 8.8 Preserve current redirect replay behavior for active existing orders
- [ ] 8.9 Implement retry behavior according to the Phase 7 state machine
- [ ] 8.10 Update checkout service tests that currently assume no mutable side effects before final submit
- [ ] 8.11 Reject or restart hosted checkout creation when the existing `NEW` hold is already past `reservationHoldExpiresAt`, after invoking the cleanup service rather than starting another HPP session against an expired hold
- [ ] 8.12 Preserve active redirect replay only while the order still has an active `NEW` hold or an already-started provider session that must be reconciled

## Phase 9: Dotypos Reservation Confirmation [PENDING]
- [ ] 9.1 Add Dotypos package API wrapper for updating reservation status
- [ ] 9.2 Add Dotypos service method for confirming a reservation by ID
- [ ] 9.3 Add workspace adapter function to confirm an existing workspace reservation
- [ ] 9.4 Change paid fulfillment `ensureReservation` to confirm existing `dotyposReservationId` instead of returning early
- [ ] 9.5 Keep fallback `CONFIRMED` creation for paid orders without a pre-created reservation to protect legacy/in-flight orders
- [ ] 9.6 Mark local lifecycle `CONFIRMED` and set `reservationConfirmedAt` after successful Dotypos confirmation
- [ ] 9.7 Add paid fulfillment tests for confirming existing `NEW` reservations, legacy fallback creation, local confirmation markers, and preserving idempotency
- [ ] 9.8 If payment succeeds after the original `NEW` hold was already `CANCELLED`, attempt to create a replacement `CONFIRMED` reservation only if current availability/business rules allow it
- [ ] 9.9 If confirmation or replacement `CONFIRMED` creation fails, mark fulfillment failed with a specific unfulfillable-reservation reason and hand the paid order to refund compensation without sending access or internal paid-reservation emails
- [ ] 9.10 Define deterministic handling for payment success while lifecycle is `cancellation_pending`: wait/reload briefly or resolve the cancellation state before choosing confirm, replacement creation, or refund compensation
- [ ] 9.11 Add paid-fulfillment tests for paid-after-cancelled hold, replacement `CONFIRMED` success, replacement failure leading to refund compensation, and `cancellation_pending` race handling

## Phase 10: Refund Compensation [PENDING]
- [ ] 10.1 Verify the Nexi refund endpoint shape against official Nexi documentation before implementation, including method/path, required headers, path parameters, request body, response fields, and sandbox/production base URLs
- [ ] 10.2 Extend the Nexi OpenAPI/client layer or add a narrowly scoped manual wrapper for the verified refund endpoint, expected to be `POST /operations/{operationId}/refunds` based on current external documentation
- [ ] 10.3 Add `NexiApi.refundPayment` and `NexiService.refundPayment` using `X-API-KEY`, `Correlation-Id`, a persisted provider `Idempotency-Key`, amount, currency, and an optional description
- [ ] 10.4 Generate the refund provider `Idempotency-Key` exactly once at refund-claim time, persist it before calling Nexi, and reuse it for every retry or duplicate webhook that targets the same refund attempt
- [ ] 10.5 Update Nexi payment verification to return and persist the actual executed payment `operationId` from `AUTHORIZATION` or `CAPTURE`, rather than storing the provider order ID as the operation ID
- [ ] 10.6 Persist the provider refund result identifier, refund operation ID, and refund provider status separately from the original successful payment operation ID
- [ ] 10.7 Add repository methods to claim refund exactly once, mark refund succeeded idempotently, and mark refund failed with retryable provider/error metadata
- [ ] 10.8 Add a workspace payment compensation service that refunds paid orders whose reservation confirmation or replacement `CONFIRMED` creation failed after payment success
- [ ] 10.9 Trigger refund compensation from the Nexi webhook success path after paid fulfillment returns the specific unfulfillable-reservation failure; avoid issuing duplicate refunds on duplicate webhooks
- [ ] 10.10 Keep `paymentStatus: "paid"` for successfully captured payments and represent refund progress separately as pending, succeeded, or failed
- [ ] 10.11 If the refund API fails, leave the order in a recoverable refund-failed/pending state for retry or manual support rather than repeatedly failing the same webhook indefinitely
- [ ] 10.12 Update checkout status/result UI to distinguish refund pending, refunded, and refund failed/manual-support states
- [ ] 10.13 Add tests for refund request construction, verified endpoint contract handling, operation ID persistence, persisted refund idempotency key reuse, refund result identifier/status persistence, refund claim idempotency, duplicate webhook behavior, refund failure recovery, and paid-unfulfillable status rendering

## Phase 11: Copy And Notes [PENDING]
- [ ] 11.1 Update Dotypos reservation note copy to remove `post-payment reservation`
- [ ] 11.2 Ensure reservation notes reflect whether a reservation was created pre-payment, cancelled as an expired hold, replaced after payment, or confirmed post-payment

## Phase 12: Verification [PENDING]
- [ ] 12.1 Run focused unit tests for reservation submit, checkout service, payment order repository, paid fulfillment, hold cleanup, and refund compensation using `bun`
- [ ] 12.2 Run broader workspace test suite using `bun`
- [ ] 12.3 Run typechecking using `bun`
- [ ] 12.4 Manually exercise happy path from reservation form to pay page to webhook/fulfillment in a local or staging-safe setup
- [ ] 12.5 Manually exercise abandon, payment failure, retry, duplicate submit, concurrent submit, attach-failure recovery, pricing-changed, stale-hold cleanup, paid-after-cancelled-hold, replacement failure, and refund flows

## Notes
- 2026-06-01: Current form submission only creates a signed pay-state URL token and does not create a local order, Dotypos customer, or Dotypos reservation. `ref:tory-black-boar`
- 2026-06-01: Current local lifecycle is represented by `payment_orders`; there is no workspace reservations table. `ref:tory-black-boar`
- 2026-06-01: Current `attachDotyposReservation` guard only allows attachment for paid processing orders, so early attachment needs a new transition or changed guard. `ref:tory-black-boar`
- 2026-06-01: Current paid fulfillment returns early when `dotyposReservationId` is already set; this must change or pre-created `NEW` reservations will never be confirmed. `ref:tory-black-boar`
- 2026-06-01: Creating Dotypos customer/reservation on form submit changes the current legal boundary, so privacy policy evidence must be collected before that mutation.
- 2026-06-01: No draft/intent table should be added; the implementation should adapt `payment_orders` and checkout details instead.
- 2026-06-01: Plan review requested explicit handling for partial local-order creation, form-submit idempotency, retry/cancel state transitions, and legacy fulfillment fallback. `ref:realistic-amber-ostrich`
- 2026-06-01: Second plan review requested concrete idempotency storage/uniqueness, handling for remote reservation success followed by local attach failure, a legal audit sink for false pre-order evidence, and earlier lifecycle marker work. `ref:disciplinary-violet-gayal`
- 2026-06-01: Third plan review requested a local `creating` claim before Dotypos create, exact recovery sink fields, precise idempotency uniqueness/collision privacy, and `cancellation_pending` retry semantics. `ref:constitutional-coral-stingray`
- 2026-06-01: User clarified that the idempotency key is the customer-plus-reservation combo, not a random client-generated key.
- 2026-06-01: Manual Dotypos API testing with customer `2141828238116791` created two simultaneous `NEW` reservations for the same table/time window, proving Dotypos does not enforce this uniqueness; both test reservations were cancelled successfully.
- 2026-06-01: Fourth plan review approved the plan and noted that `reservationSubmitKey` should be a non-reversible canonical digest/HMAC of the customer-plus-reservation tuple, not raw tuple storage. `ref:smart-moccasin-lamprey`
- 2026-06-01: The explicit local checkout TTLs are 10 minutes for signed pay-state tokens and checkout return-state tokens; the Nexi HPP request currently sends no expiry field and the generated schema has no expiry/valid-until/session TTL field. `ref:sufficient-coffee-lemur`
- 2026-06-01: The workspace app currently has no scheduled cleanup route or Vercel cron configuration, so stale `NEW` hold cancellation needs a new scheduled job plus opportunistic cleanup hooks. `ref:sufficient-coffee-lemur`
- 2026-06-01: User chose Vercel Cron for the recurring stale-hold sweeper and bounded cleanup before workspace availability queries Dotypos reservations; Vercel Cron should be treated as recurring sweep infrastructure, not exact per-reservation one-time scheduling.
- 2026-06-01: Dotypos reservation types do not provide a hold-expiry field, so `reservationHoldExpiresAt` is local workspace state on `payment_orders`, while Dotypos only receives lifecycle status changes such as `NEW` and `CANCELLED`.
- 2026-06-01: Nexi refund support is absent from the repository; the Nexi package currently exposes only hosted payment page creation and order verification. `ref:unwilling-amaranth-worm`
- 2026-06-01: Nexi refund integration must persist the real successful provider operation ID because the refund endpoint operates on `/operations/{operationId}/refunds`, while current workspace metadata stores the provider order ID instead. `ref:unwilling-amaranth-worm`
- 2026-06-01: Fifth plan review requested persistent reuse of one refund idempotency key, explicit verification of the refund endpoint contract, separate refund result identifier/status persistence, and an explicit late-success `payment_pending` plus `CANCELLED` reservation transition into paid compensation handling. `ref:grieving-crimson-hoverfly`
