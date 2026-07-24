# Workspace Checkout Lifecycle

This document is the Phase 1 contract for the Workspace checkout database rewrite. It supersedes the earlier `payment_orders`-centered model for new implementation work.

The local database is a Deskohub workflow, payment, legal, and recovery ledger. Dotypos remains the source of truth for customer facts and reservation facts. Nexi remains the source of truth for payment processing facts. The local database must not become a customer profile store, a reservation fact store, a raw provider payload archive, or a return-state token store.

## Core lifecycle tables

The core checkout lifecycle uses these tables:

- `workspace_reservations`
- `payment_attempts`
- `webhook_events`
- `legal_evidence_events`

Do not recreate `checkout_return_state_tokens` as a state table. Return pages must derive enough context from signed URL state, route parameters, Nexi verification, and the durable rows above.

Discount configuration and audit history extend this lifecycle through `discounts`, `discount_product_targets`, `discount_codes`, `discount_code_customers`, `discount_applications`, and `discount_code_redemptions`. These tables store only source-neutral benefit configuration, Dotypos customer IDs, generic application snapshots, and claim state. They must not store customer contact data, Workspace access codes, or raw provider payloads. See [Workspace discount-code operations](./discount-codes.md).

## Advertised, quoted, and payable prices

Checkout has three distinct price boundaries:

1. The reservation page advertises a price.
2. Reservation submission creates the order-summary quote that the customer reviews.
3. Order submission freshly affirms that signed summary before payment begins.

The server must issue an integrity-protected advertisement snapshot for the product and reservation inputs whose price is visible on the reservation page. Reservation-page advertisement evaluates only automatic discounts that can be discovered without customer identity; currently this means Calendar sales. It must not resolve or create a Dotypos customer merely to advertise a price. Customer-specific pricing is outside the advertisement boundary by contract and does not need an inert marker in the snapshot. The snapshot contains no customer PII and is carried back by the reservation form without treating client-authored price data as authoritative. The signed order-summary state performs the same role for the price reviewed on the summary page.

On reservation submission, the server opens the advertisement snapshot and freshly affirms only the anonymously discoverable automatic discounts that were advertised. A Calendar sale that became available after the snapshot was issued is not added retrospectively. After that boundary is affirmed, the normal reservation workflow resolves or creates the Dotypos customer and evaluates the customer discount for the first signed order summary. Because customer-specific pricing could not be evaluated at the anonymous advertisement boundary, that customer discount may first appear on the summary without producing `pricing_changed`. This is an explicit boundary contract, not a general permission to introduce later automatic discounts.

Once a customer discount has appeared in a signed summary, it is an accepted discount like any other: code submission must affirm it before changing the summary, final order submission must freshly affirm it, and its disappearance or change produces the normal `pricing_changed` result. No later workflow may use the anonymous-advertisement exception to replace, add, or silently remove a customer discount that the customer has already seen.

`pricing_changed` is a normal workflow result at both transitions, not an exceptional checkout failure:

- If anonymous discount discovery fails before the reservation page is rendered, log the error, omit that discount from the advertisement, and continue without it. Quote generation must not add an anonymously discoverable automatic discount that becomes available after the advertisement snapshot was issued.
- If a discount in the advertisement snapshot cannot be included when reservation submission creates the quote, create the current quote without that discount and return `pricing_changed` for every affected summary product key, such as `product:cowork:basic`. The customer must review the changed summary before payment can be requested.
- If a discount in the signed summary cannot be freshly affirmed at order submission, return `pricing_changed` with a refreshed signed summary. Create no durable payment attempt and no external payment session.
- Newly available anonymously discoverable automatic discounts are never introduced retrospectively during quote generation or final affirmation. They may appear only through a new advertisement/summary cycle. The customer discount may first appear only at the first signed-summary boundary after Dotypos identity resolution, as described above. A successfully submitted discount code is a separate deliberate exception because the customer explicitly requested that quote change.

Discount code entry belongs on the order-summary page as an independent form with its own server action, pending state, and field error. It must not resubmit the reservation form or the main order submission:

- The action receives the current signed summary and submitted code.
- It first affirms every discount already displayed. If any changed, it returns the normal `pricing_changed` result and a refreshed signed summary.
- An unavailable or invalid code returns a field-level error and leaves the existing signed summary payable. It never blocks proceeding without the code.
- A valid code returns a new signed summary containing the code discount. It does not create a payment attempt, persist an application, or reserve code capacity.
- Once present in the signed summary, a code follows the same final affirmation and payment-lifecycle rules as every other discount.

The hard payment invariant is that a provider session amount must exactly equal the last signed summary price shown to the customer. Order submission freshly affirms exactly the discounts in that summary and compares the complete quote fingerprint and total. A mismatch—or a failure to persist applications or admit a claim atomically—returns `pricing_changed`; the transaction rolls back and Nexi is not called.

Advertised, signed, and freshly affirmed quotes and local payment attempts always retain the catalog currency. The controlled non-production Nexi sandbox currency override is a provider-adapter exception only: Workspace applies it immediately before HPP creation and again when constructing Nexi verification arguments. The override never changes locally persisted payment facts, the customer-visible quote, its numeric minor-unit value, or its exponent, and it is unavailable for production or the live Nexi origin.

## Ownership

| Data | Owner | Local DB contract |
| --- | --- | --- |
| Customer name, email, phone | Dotypos customer | Store only `dotypos_customer_id`. Never store as columns, JSON, event text, or raw payload. |
| Dotypos reservation date, service options, staff note, reservation status | Dotypos reservation | Store `dotypos_reservation_id` and local workflow timestamps/states only. Read Dotypos when reservation facts are needed. |
| Checkout session and attempt idempotency | Deskohub workflow | Store only the HMAC session and attempt keys. The object payloads used to derive them are transient and must not be persisted. |
| Payment session and terminal state | Nexi plus Deskohub workflow | Store payment attempts, Nexi order IDs, non-PII security tokens, operation IDs/statuses, redirect URL if needed for retry support, and local payment state. |
| Nexi webhooks | Nexi plus Deskohub workflow | Store dedupe identity and normalized processing state. Never store raw notification bodies or optional sensitive provider fields. |
| Legal acceptance | Deskohub legal evidence | Store document keys, paths, hashes, acceptance booleans, timestamps, locale, source, and idempotency keys. Never store rendered legal documents or customer contact data. |

## No-PII Policy

No customer PII may be persisted in database columns, JSON, text messages, or event metadata. This includes customer name, email, phone number, payment instrument data, Nexi `customerInfo`, raw provider payloads, and free-form user notes.

Allowed local values:

- Dotypos customer IDs and reservation IDs.
- Deskohub IDs, correlation IDs, HMAC checkout session and attempt keys, payment attempt IDs, webhook event IDs, and provider operation IDs.
- Nexi `securityToken`, because it is short-lived non-PII and needed for payment-attempt safety.
- Legal document paths and hashes.
- Local state enums, timestamps, and normalized failure codes.
- Payment amounts, currencies, quote fingerprints, and product price metadata needed to verify a Nexi result, provided they do not include customer or reservation facts that Dotypos owns.

Enforcement boundary:

- Server actions may hold customer PII in memory only long enough to find or create the Dotypos customer and derive the transient checkout-key payloads.
- Repository inputs must be shaped so PII has no destination field.
- `jsonb` columns must use schemas that exclude customer contact fields, free-form customer notes, raw provider envelopes, and raw Dotypos responses.
- Logs may contain PII only under the application's global filtering policy.
- Any future column or JSON field that can carry customer-authored free text is forbidden unless a separate privacy review explicitly reclassifies it.

## Table Contracts

### `workspace_reservations`

One row per Deskohub checkout workflow for a Dotypos reservation hold and its payment lifecycle.

| Column | Type | Required | Purpose |
| --- | --- | --- | --- |
| `id` | text | yes | Local workflow ID. Stable route/support reference. |
| `checkout_session_key` | text | yes | HMAC key grouping deliberate reservation submissions while the customer moves between Reservation and Pay. Stores only the digest. |
| `checkout_attempt_key` | text | yes | HMAC idempotency key for one mounted-form submission and its immediate retry. Includes the normalized reservation details and stores only the digest. |
| `correlation_id` | text | yes | Non-PII cross-system tracing ID. Unique. |
| `dotypos_customer_id` | text | yes | Dotypos customer that owns customer PII. |
| `dotypos_reservation_id` | text | no | Dotypos reservation hold/final reservation ID. Null until Dotypos creates it. |
| `reservation_state` | text enum | yes | Local reservation workflow state. |
| `payment_state` | text enum | yes | Aggregate payment state across attempts. |
| `fulfillment_state` | text enum | yes | Local post-payment/legal-delivery workflow state. |
| `active_payment_attempt_id` | text | no | Current payment attempt, if a Nexi session exists. |
| `reservation_hold_expires_at` | timestamptz | no | Local hold deadline used for cleanup scheduling. Mirrors Deskohub hold policy, not Dotypos facts. |
| `reservation_hold_expired_at` | timestamptz | no | When local cleanup observed the hold as expired. |
| `reservation_created_at` | timestamptz | no | When Dotypos reservation creation succeeded. |
| `reservation_confirmed_at` | timestamptz | no | When paid workflow confirmed the Dotypos reservation. |
| `reservation_cancelled_at` | timestamptz | no | When Dotypos cancellation succeeded or Dotypos already reported cancellation. |
| `cancellation_claim_owner` | text | no | Opaque per-worker cancellation owner. Paired with `cancellation_claimed_at`; ownerless legacy rows remain valid during rollout. |
| `cancellation_claimed_at` | timestamptz | no | Database-clock start or renewal time of the current cancellation lease. |
| `cancellation_failure_disposition` | text | no | `retryable` for automatic recovery or `manual_review` for an excluded poison row. |
| `cancellation_retry_at` | timestamptz | no | Database-clock retry eligibility time; required only for retryable cancellation failures. |
| `cancellation_recovery_reason` | text | no | Audit reason for the current cancellation path: genuine hold expiry, attachment compensation, supersession recovery, retryable failure, or stale-claim recovery. |
| `paid_at` | timestamptz | no | When a verified Nexi attempt made the workflow paid. |
| `fulfilled_at` | timestamptz | no | When all required post-payment work completed. |
| `fulfillment_failed_at` | timestamptz | no | Most recent fulfillment failure time. |
| `failure_code` | text | no | Normalized non-PII workflow failure code. |
| `fulfillment_failure_code` | text | no | Normalized non-PII fulfillment failure code. |
| `created_at` | timestamptz | yes | DB-managed creation timestamp. |
| `updated_at` | timestamptz | yes | DB-managed update timestamp. |

Indexes and constraints:

- Primary key on `id`.
- Unique index on `checkout_attempt_key`.
- Partial unique index on `checkout_session_key` while `reservation_state <> 'cancelled'`.
- Lookup index on `(checkout_session_key, created_at)`.
- Unique index on `correlation_id`.
- Partial unique index on `dotypos_reservation_id` where not null.
- Partial index on `reservation_hold_expires_at` for `reservation_state = 'held'`.
- Partial cancellation recovery index on `(reservation_state, cancellation_recovery_reason, cancellation_failure_disposition, cancellation_retry_at, cancellation_claimed_at)` for `cancelling` and `cancellation_failed`.
- Recovery index on `(reservation_state, payment_state, fulfillment_state)`.
- `dotypos_reservation_id` must be non-null for `held`, `confirming`, `confirmed`, `cancelling`, `cancelled`, and `cancellation_failed` states.
- `paid_at` must be non-null when `payment_state = 'paid'`.
- `fulfilled_at` must be non-null when `fulfillment_state = 'fulfilled'`.
- `fulfillment_failed_at` and `fulfillment_failure_code` must be non-null when `fulfillment_state = 'failed'`.
- Cancellation claim owner and timestamp must both be null or both be present.
- Retryable cancellation failures require a retry timestamp; manual-review failures must not have one.
- Cancellation recovery reasons are restricted to the documented audit values. Only a genuine hold-expiry observation may write `reservation_hold_expired_at`; other recovery reasons never synthesize or overwrite it.

### `payment_attempts`

One row per Nexi HPP/session creation attempt. Retries create new attempts instead of overwriting prior attempt history.

| Column | Type | Required | Purpose |
| --- | --- | --- | --- |
| `id` | text | yes | Local payment attempt ID. |
| `workspace_reservation_id` | text | yes | Parent workflow row. |
| `provider` | text enum | yes | Initial value: `nexi`. |
| `provider_order_id` | text | yes | Nexi order ID, normally the value sent to `order.orderId`. Unique for Nexi. |
| `security_token` | text | no | Nexi HPP security token. Short-lived non-PII. |
| `state` | text enum | yes | Attempt-level payment state. |
| `amount_value` | integer | yes | Expected payment amount in scaled integer form. |
| `amount_exponent` | integer | yes | Currency exponent used for amount verification. |
| `currency` | text | yes | Uppercase ISO currency code. |
| `provider_redirect_url` | text | no | Nexi hosted page URL, if needed to resume redirect before expiry. |
| `last_webhook_event_id` | text | no | Last normalized webhook event applied to this attempt. |
| `last_provider_operation_id` | text | no | Last provider operation ID observed. |
| `last_provider_status` | text | no | Last normalized provider status observed. |
| `failure_code` | text | no | Normalized non-PII unsuccessful terminal code. |
| `created_at` | timestamptz | yes | DB-managed creation timestamp. |
| `updated_at` | timestamptz | yes | DB-managed update timestamp. |

Indexes and constraints:

- Primary key on `id`.
- Foreign key to `workspace_reservations(id)`.
- Unique index on `(provider, provider_order_id)`.
- Index on `workspace_reservation_id`.
- Recovery index on `(state, created_at)`.
- `provider = 'nexi'` for the initial implementation.
- `amount_exponent` must be between `0` and `20`.
- `currency` must be uppercase three-letter text.
- `failure_code` must be non-null for failed/cancelled/expired terminal states.

### `webhook_events`

One row per Nexi webhook event identity for dedupe and normalized processing status.

| Column | Type | Required | Purpose |
| --- | --- | --- | --- |
| `id` | text | yes | Local webhook row ID. |
| `provider` | text enum | yes | Initial value: `nexi`. |
| `event_id` | text | yes | Provider event ID or deterministic identity derived from non-secret official fields. Unique. |
| `payment_attempt_id` | text | no | Associated payment attempt when known. |
| `provider_order_id` | text | no | Non-PII provider order ID from `operation.orderId`, for lookup before attempt association. |
| `received_at` | timestamptz | yes | When the webhook was received. |
| `processed_at` | timestamptz | no | When processing completed successfully. |
| `state` | text enum | yes | Webhook processing state. |
| `error_code` | text | no | Normalized non-PII processing error code. |
| `created_at` | timestamptz | yes | DB-managed creation timestamp. |
| `updated_at` | timestamptz | yes | DB-managed update timestamp. |

No raw notification payload, `securityToken`, `customerInfo`, warnings, `additionalData`, card data, or provider response body may be stored.

### `legal_evidence_events`

Append-only legal acceptance/rejection evidence. Legal hashes may also be used during workflow decisions, but this table is the durable legal event stream.

| Column | Type | Required | Purpose |
| --- | --- | --- | --- |
| `id` | text | yes | Local legal evidence event ID. |
| `workspace_reservation_id` | text | no | Associated workflow row when known. |
| `idempotency_key` | text | yes | Submit HMAC or other non-PII dedupe key. |
| `document_key` | text | yes | Stable internal document key. |
| `document_path` | text | yes | Path of accepted document version. |
| `document_hash` | text | yes | SHA-256 hash of accepted/rejected document. |
| `hash_algorithm` | text enum | yes | Initial value: `sha256`. |
| `accepted` | boolean | yes | Whether the customer accepted this document/acknowledgement. |
| `accepted_at` | timestamptz | yes | Server timestamp for the acceptance decision. |
| `locale` | text | yes | Locale of the legal document shown. |
| `source` | text | yes | Normalized source, for example `reservation_submit`, `retry_submit`, or `migration_backfill`. |
| `created_at` | timestamptz | yes | DB-managed creation timestamp. |

Indexes and constraints:

- Primary key on `id`.
- Index on `workspace_reservation_id`.
- Index on `(idempotency_key, document_hash)`.
- `hash_algorithm = 'sha256'`.
- No rendered document bodies or PII-bearing consent payloads.

## Lifecycle Enums

### Reservation State

- `draft`: local workflow exists before Dotypos hold creation is claimed.
- `creating_hold`: a worker has claimed Dotypos reservation hold creation.
- `held`: Dotypos has a `NEW` hold and local payment may proceed.
- `hold_expired`: local policy observed the hold deadline before payment completed.
- `confirming`: payment is verified paid and a worker is confirming/finalizing the Dotypos reservation.
- `confirmed`: Dotypos reservation is confirmed/final for the paid booking.
- `cancelling`: a worker is cancelling a Dotypos hold.
- `cancelled`: Dotypos hold was cancelled or Dotypos already reports it as cancelled.
- `cancellation_failed`: cancellation failed and needs retry/manual recovery.

Allowed reservation transitions:

- `draft -> creating_hold -> held`
- `creating_hold -> cancellation_failed` when the hold is created in Dotypos but local attachment fails. The failed attachment is queued immediately for owned cancellation compensation.
- `creating_hold -> draft` only when Dotypos hold creation failed before any Dotypos reservation ID existed.
- `held -> confirming -> confirmed` after verified paid payment.
- `held -> hold_expired -> cancelling -> cancelled` for unpaid expired holds.
- `held -> cancelling -> cancelled` for unsuccessful terminal payment before hold expiry.
- `cancelling -> cancellation_failed`
- `cancellation_failed -> cancelling -> cancelled`

Forbidden reservation transitions:

- Any transition from `cancelled` or `confirmed` without an explicit manual repair path.
- Any creation of a second Dotypos reservation for the same `checkout_attempt_key`.
- Any creation of a replacement Dotypos reservation in the same checkout session before the prior local and Dotypos reservations are cancelled.
- Any cancellation finalization unless the row is still in `cancelling`, unpaid, and unconfirmed.
- Any Dotypos cancellation DELETE unless the worker has reloaded and renewed the row after the live provider-status read and still owns its current cancellation claim.

### Cancellation ownership and live provider status

Cancellation is a compare-and-set lease, not ownership inferred from `reservation_state` alone. A worker atomically writes a fresh opaque owner and database-generated `cancellation_claimed_at` while moving an eligible row to `cancelling`. Every completion, failure, supersession transaction, and ownership renewal compares that same owner. After reading live provider status, the worker renews the timestamp with an owner-CAS update and uses the returned row as its reload. A worker whose renewal no longer finds its owner stops without provider or local destructive work.

The lease is five minutes. Acquisition, renewal, retry eligibility, and stale takeover compare against the database clock so application-host clock skew cannot shorten or extend ownership. `cancelling` may be taken over only when its paired lease timestamp is at or before the database's five-minute stale cutoff. During migrate-before-promote overlap, a database trigger replaces an old writer's application-clock `updated_at` whenever it writes an ownerless `cancelling` row; legacy takeover therefore uses a database-stamped `updated_at` for the same bounded grace period. Retryable failures carry a database-generated retry time; failures that require manual review carry no retry time and are excluded from bounded cron batches. Queue delivery is the primary cleanup path; the daily cron selects expired held rows, due retryable failures, legacy recoverable rows, and only stale cancelling leases.

Cancellation recovery carries an explicit reason through queue, cron, service, and repository calls. `reservation_hold_expired_at` is written only when an unpaid held reservation's real deadline was observed at or before the cleanup timestamp. Attachment compensation, supersession recovery, retryable failures, and stale-claim takeover never synthesize that audit fact.

After Dotypos creates a reservation, a failed local attachment hands the exact Dotypos reservation ID to two independent durable recovery paths: the local cancellation marker and an identity-bearing queue message retained for the queue provider's seven-day maximum. Both are attempted even if the other fails. A surviving marker is recoverable by cron when enqueue fails; a surviving queue message can idempotently materialize the marker when the original marker write fails. Duplicate or delayed messages only materialize the original `creating_hold`/initial attachment-failure state with the same provider ID and cannot overwrite a successfully attached, differently owned, retried, manually reviewed, or completed reservation. If neither durable handoff succeeds, the action fails loudly rather than reporting a successful handoff.

A legacy `cancelling` or `cancellation_failed` row with `payment_state = 'pending'` is never sent directly to cancellation. Recovery first CAS-restores it to `held`, allowing the existing provider-payment finalization contract to resolve paid, terminal, or still-pending outcomes. Paid stays held for fulfillment, terminal unsuccessful can proceed through a fresh cancellation claim, and unconfirmed outcomes remain held for later reconciliation.

The live Dotypos policy has one shared matrix:

| Fresh Dotypos status | Cancellation action |
| --- | --- |
| `NEW` | Reload and renew local ownership, then issue DELETE. |
| `CANCELLED` | Reload and renew local ownership, then complete the local cancellation without DELETE. |
| Every other live status | Refuse DELETE and record an owned manual-review failure that cron does not repeatedly retry. |

The provider read and DELETE cannot be made atomic across Deskohub and Dotypos. A Dotypos reservation can change after the fresh status read and before DELETE; this is the unavoidable provider read/delete TOCTOU. Keeping the interval short, reloading and renewing current local ownership after the read, and refusing every freshly observed status other than `NEW` bound what Deskohub can control. Dotypos must remain authoritative if this race is observed.

### Payment State

Aggregate `workspace_reservations.payment_state` values:

- `not_started`: no active Nexi session exists.
- `pending`: at least one Nexi attempt is awaiting a terminal result.
- `paid`: Nexi verification confirmed successful payment.
- `failed`: Nexi verification returned payment failure.
- `cancelled`: Nexi/customer cancelled payment.
- `expired`: Nexi/session/hold expiry ended the payment workflow.

Attempt-level `payment_attempts.state` values:

- `created`: local attempt exists before HPP session details are attached.
- `pending`: customer can be redirected to Nexi or Nexi is processing.
- `paid`: verified terminal successful attempt.
- `failed`: verified terminal failed attempt.
- `cancelled`: verified terminal cancellation.
- `expired`: verified terminal expiry or local attempt expiry.

Allowed payment transitions:

- Reservation aggregate: `not_started -> pending -> paid`.
- Reservation aggregate: `not_started -> pending -> failed|cancelled|expired`.
- Attempt: `created -> pending -> paid|failed|cancelled|expired`.
- Terminal aggregate updates require the active payment attempt ID and only apply while the aggregate state is still `pending` on a held reservation.
- Attempt terminal updates only apply from non-terminal attempt states; `paid` can only be set from `pending`.
- Webhook terminal updates must update the attempt row and reservation aggregate in one database transaction. Provider retries may reapply a matching terminal attempt/reservation pair as an idempotent no-op, but must not mark one side terminal when the other side fails its guard.
- Discount application persistence and code-claim admission belong to the payment-attempt creation transaction. Claim redemption belongs to the paid transaction, and claim release belongs to every failed, cancelled, or expired transaction. Any application, claim, redemption, or release error is fatal and rolls back the owning payment transition; it must never be converted to an empty discount result or `not_pending` state.
- Failed/cancelled/expired workflows may create a new `payment_attempts` row only when the reservation is still `held` and hold deadline is valid.
- `paid` is terminal for payment state.

### Fulfillment State

- `not_started`: no post-payment confirmation/delivery work has completed.
- `processing`: paid workflow is claimed by a fulfillment worker.
- `fulfilled`: Dotypos reservation confirmation and required access/internal notifications are complete.
- `failed`: payment succeeded but fulfillment needs retry or manual recovery.

Allowed fulfillment transitions:

- `not_started -> processing -> fulfilled`
- `not_started -> processing -> failed`
- `failed -> processing -> fulfilled`
- `processing -> failed`

Fulfillment is allowed only when `payment_state = 'paid'`.

## Checkout Session And Attempt HMACs

`checkoutSessionId` groups the reservation rows created while a customer moves back and forth between Reservation and Pay. It remains stable when the customer returns to the form and deliberately submits again. `checkoutAttemptId` identifies one mounted-form submission and its immediate transport retry; a changed form value or a new form mount creates a new attempt.

Only HMAC digests are stored in `workspace_reservations.checkout_session_key` and `workspace_reservations.checkout_attempt_key`. The opaque browser IDs are carried only in signed checkout state and action input. Both key payloads use `JSON.stringify` on a fixed object shape; do not sort keys or build a delimiter-joined tuple.

```ts
const checkoutSessionKey = hmac({
  checkoutSessionId,
});

const checkoutAttemptKey = hmac({
  checkoutSessionId,
  checkoutAttemptId,
  reservation: normalizedReservation,
});
```

The normalized reservation is included so a replayed opaque attempt ID with changed values cannot reuse a hold created for different facts; its PII exists only in the transient HMAC payload. An exact attempt-key match makes an immediate retry idempotent. A new attempt in the same session does not mutate or reuse the existing Dotypos reservation: the server claims the previous unpaid hold for cancellation, verifies its live Dotypos status, cancels it when `NEW`, marks its local row cancelled, and creates a fresh local and Dotypos reservation. If the previous row has pending/paid payment, is no longer pending in Dotypos, or its Dotypos cancellation fails, the server leaves that row to its normal lifecycle and rotates to a fresh checkout session before creating the new reservation. Every created row keeps its original cleanup deadline and scheduled cleanup job.

## Sequence Diagrams

### Reservation Submit And Hold

```mermaid
sequenceDiagram
  actor Customer
  participant App as Workspace Server Action
  participant DB as Local DB
  participant Dotypos

  Customer->>App: Submit reservation/contact/legal form
  App->>App: Open anonymous advertised-price snapshot
  App->>App: Validate input and legal consent
  App->>App: Affirm only its advertised anonymous automatic discounts
  App->>App: Derive checkout session and attempt HMACs
  App->>Dotypos: Find or create customer using PII
  Dotypos-->>App: dotyposCustomerId
  App->>App: Evaluate customer discount for the first signed summary
  alt same attempt is already held
    App->>DB: Reuse exact attempt row
  else session has an earlier unpaid hold
    App->>DB: Claim earlier row for cancellation
    App->>Dotypos: Cancel earlier NEW reservation
    App->>DB: Mark earlier row cancelled and insert replacement draft
  else no current row in session
    App->>DB: Insert workspace_reservations(draft, not_started, not_started)
  end
  App->>DB: Claim reservation_state=creating_hold
  App->>Dotypos: Create NEW reservation hold
  Dotypos-->>App: dotyposReservationId
  App->>DB: Set reservation_state=held and hold deadline
  App->>DB: Insert legal_evidence_events
  alt advertised price still matches
    App-->>Customer: Show signed order summary, which may first add the customer discount
  else advertised discount unavailable
    App-->>Customer: Show refreshed signed summary with pricing_changed affected product keys; customer discount may still first appear
  end
```

### Independent Discount Code Form

```mermaid
sequenceDiagram
  actor Customer
  participant Summary as Order Summary
  participant App as Workspace Server Action

  Customer->>Summary: Submit discount-code form
  Summary->>App: Current signed summary + submitted code
  App->>App: Affirm every displayed discount
  alt displayed price changed
    App-->>Summary: pricing_changed + refreshed signed summary
  else code unavailable
    App-->>Summary: Field error; retain current signed summary
  else code accepted
    App-->>Summary: New signed summary containing code discount
  end
```

### Payment Attempt And Nexi Redirect

```mermaid
sequenceDiagram
  actor Customer
  participant App as Workspace Server Action
  participant DB as Local DB
  participant Nexi

  Customer->>App: Request payment for held workflow
  App->>DB: Load held workspace_reservations row
  App->>App: Freshly affirm exactly the signed-summary discounts and total
  alt fingerprint, total, or claim admission changed
    App-->>Customer: pricing_changed + refreshed signed summary; no payment session
  else signed price affirmed
    App->>DB: In one transaction create/link attempt, persist discount applications, and reserve code claim
    App->>Nexi: POST /orders/hpp with the exact signed-summary amount
    Nexi-->>App: hostedPage and securityToken
    App->>DB: Store securityToken, redirect URL, attempt pending
    App-->>Customer: Redirect to hostedPage
  end
```

### Webhook Success And Dotypos Confirmation

```mermaid
sequenceDiagram
  participant Nexi
  participant Webhook as Webhook Route
  participant DB as Local DB
  participant Dotypos
  participant Fulfillment

  Nexi->>Webhook: Official notification envelope
  Webhook->>Webhook: Decode envelope; derive event identity
  Webhook->>DB: Insert webhook_events(received) or load duplicate state
  alt duplicate processed
    Webhook-->>Nexi: No-op success
  else duplicate failed/received or fresh event
  Webhook->>DB: Claim retry only if webhook_events is not processed
  Webhook->>DB: Load payment attempt by provider_order_id
  Webhook->>Webhook: Compare notification securityToken if present
  Webhook->>Nexi: GET /orders/{provider_order_id}
  Nexi-->>Webhook: Verified payment result
  Webhook->>DB: In one transaction mark attempt/reservation paid and redeem reserved discount claim
  Webhook->>DB: Claim fulfillment_state=processing and reservation_state=confirming
  Fulfillment->>Dotypos: Confirm/finalize reservation using dotyposReservationId
  Dotypos-->>Fulfillment: Confirmation success
  Fulfillment->>DB: reservation_state=confirmed, fulfillment_state=fulfilled
  Webhook->>DB: webhook_events processed
  end
```

### Nexi Failure, Cancel, Or Expired Return

```mermaid
sequenceDiagram
  actor Customer
  participant Return as Return/Status Route
  participant DB as Local DB
  participant Nexi
  participant Cleanup as Hold Cleanup
  participant Dotypos

  Customer->>Return: Return from Nexi failure/cancel/expiry
  Return->>DB: Load active payment attempt
  Return->>Nexi: Verify provider_order_id when needed
  Nexi-->>Return: Terminal unsuccessful or pending result
  Return->>DB: In one transaction mark attempt/reservation terminal and release reserved discount claim
  Return->>Cleanup: Request unpaid hold cancellation
  Cleanup->>DB: Claim reservation_state=cancelling
  Cleanup->>Dotypos: Cancel Dotypos reservation hold
  Dotypos-->>Cleanup: Cancelled or already cancelled
  Cleanup->>DB: reservation_state=cancelled
  Return-->>Customer: Show safe non-PII status
```

### Expired Hold Cleanup And Cancellation Retry

```mermaid
sequenceDiagram
  participant Job as Cleanup Job
  participant DB as Local DB
  participant Dotypos

  Job->>DB: Select expired held, cancellation_failed, and stale cancelling rows
  Job->>DB: CAS owner + claimed_at, reservation_state=cancelling
  Job->>Dotypos: Read live reservation status
  Job->>DB: Owner-CAS renew lease and reload
  alt live status is NEW
    Job->>Dotypos: DELETE reservation
    Job->>DB: Owner-CAS reservation_state=cancelled, reservation_cancelled_at
  else live status is CANCELLED
    Job->>DB: Owner-CAS reservation_state=cancelled, reservation_cancelled_at
  else other status or provider failure
    Job->>DB: Owner-CAS reservation_state=cancellation_failed
  end
  Job->>DB: Later recovery retries cancellation_failed or stale cancelling rows
```

## Recovery Rules

| Scenario | Query shape | Recovery action |
| --- | --- | --- |
| Held reservation without payment | `reservation_state = 'held' and payment_state = 'not_started'` | Allow payment attempt until hold expires. |
| Pending payment | `payment_state = 'pending'` plus active attempt | Wait for webhook, verify with Nexi, or show pending status. |
| Paid but not fulfilled | `payment_state = 'paid' and fulfillment_state in ('not_started', 'failed')` | Run fulfillment worker. |
| Fulfillment stuck | `payment_state = 'paid' and fulfillment_state = 'processing'` | Inspect staleness; retry only through guarded repair path. |
| Expired unpaid hold | `reservation_state = 'held' and payment_state <> 'paid' and reservation_hold_expires_at <= now()` | Cancel Dotypos hold. |
| Cancellation failed, retryable | `reservation_state = 'cancellation_failed' and cancellation_failure_disposition = 'retryable' and cancellation_retry_at <= now()` | Retry Dotypos cancellation. |
| Cancellation failed, manual review | `reservation_state = 'cancellation_failed' and cancellation_failure_disposition = 'manual_review'` | Exclude from automatic batches and investigate explicitly. |
| Cancellation worker stopped | `reservation_state = 'cancelling'` with a stale paired claim, or an ownerless legacy row whose `updated_at` is stale | Take over with a new owner after the bounded five-minute database-clock lease. |
| Legacy cancellation with pending payment | `reservation_state in ('cancelling', 'cancellation_failed') and payment_state = 'pending'` | After the ownership/grace guard, restore to `held` and run provider-payment reconciliation before considering cancellation. |
| Duplicate webhook | Existing `webhook_events.event_id` | Return duplicate/accepted response without reapplying side effects. |
| Legal rejection | `legal_evidence_events.accepted = false` | Do not create hold/payment; show legal consent error. |

Rollout is expand-first and supports migrate-before-promote. Before publication, the complete migration adds nullable paired-lease, failure-disposition, retry, and recovery-reason columns; backfills existing `cancellation_failed` rows as due `retryable_failure` work; database-stamps existing ownerless `cancelling` rows; installs the old-writer compatibility trigger; and adds constraints that permit both paired claims and ownerless rows. Apply that migration before promoting the ownership-aware application. Ownerless rows then receive the same five-minute database-clock grace before takeover or pending-payment restoration, regardless of old-host clock skew.

Application rollback does not remove the trigger: it is backward-compatible with old writers and must remain while any can run. Drizzle has no down-migration path here. After all old writers are retired and legacy ownerless rows have drained, a later forward-only contract migration may drop the trigger, then its function, and optionally tighten the state/owner constraint. The tradeoff is temporary acceptance of ownerless cancellation rows and a narrow compatibility trigger in exchange for safe zero-downtime ordering.

## Live Test Safety Checklist

- Confirm the database branch is development/preview, not production, before schema reset or test checkout.
- Confirm migrations do not create `checkout_return_state_tokens`.
- Confirm `workspace_reservations`, `payment_attempts`, `webhook_events`, and `legal_evidence_events` have no PII-capable columns or raw payload columns.
- Confirm checkout session/attempt key derivation stores only HMAC digests and uses `JSON.stringify` on fixed object payloads.
- Confirm Dotypos test customer lookup/create is the only persistence destination for customer name, email, and phone.
- Confirm Dotypos reservation is created as a hold before payment only for the approved hold workflow, and Dotypos remains the source of reservation facts.
- Confirm Nexi `securityToken` is stored only on `payment_attempts` and is not copied to webhook events.
- Confirm webhook handling verifies through Nexi before marking payment paid or terminal unsuccessful.
- Confirm failure/cancel/expired payment paths cancel unpaid Dotypos holds or leave guarded local state for retry.
- Confirm test data uses clearly fake customers and test payment instruments.
- Confirm no production Dotypos or Nexi credentials are used for live tests unless an explicit production smoke test has been approved.
