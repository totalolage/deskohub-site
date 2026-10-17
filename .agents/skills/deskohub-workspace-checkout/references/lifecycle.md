# Checkout lifecycle

Business policy for holds, payment, recovery, refunds, and fulfillment is in the [checkout specification](../../../../apps/deskohub-workspace/docs/checkout-lifecycle.md). Price affirmation is in [pricing.md](pricing.md).

## Contents

- [Where things live](#where-things-live)
- [Data ownership and PII](#data-ownership-and-pii)
- [State machines](#state-machines)
- [Checkout session and attempt keys](#checkout-session-and-attempt-keys)
- [Supersession](#supersession)
- [Nexi payment attempts](#nexi-payment-attempts)
- [Hold cleanup](#hold-cleanup)
- [Late payment recovery](#late-payment-recovery)
- [Refunds](#refunds)
- [Fulfillment](#fulfillment)

## Where things live

Paths are under `apps/deskohub-workspace/`.

| Concern | Code |
| --- | --- |
| Tables, columns, and check constraints | `db/schema/*.ts` |
| Reservation submission | `features/reservation/actions/prepare-pay-state.ts` |
| Pay submit | `features/reservation/actions/submit-reservation.ts`, `features/checkout/backend/checkout/checkout.service.ts` |
| Supersession | `features/checkout/backend/checkout/reservation-supersession.service.ts` |
| Lookup keys | `features/checkout/backend/checkout/checkout-lookup-keys.server.ts` |
| Status page | `features/checkout/backend/checkout/checkout-status.service.ts` |
| Nexi webhook | `app/api/webhooks/nexi/route.ts`, `features/checkout/backend/payment/nexi-webhook.service.ts` |
| Finalization from status and cleanup | `features/checkout/backend/payment/provider-payment-finalization.service.ts` |
| Late payment | `features/checkout/backend/payment/late-payment-*.ts`, queue `app/api/queues/workspace/late-payment-recovery` |
| Refund reconciliation | `features/checkout/backend/payment/payment-refund.service.ts`, cron `app/api/cron/workspace/payment-refunds` |
| Hold cleanup | `features/checkout/backend/holds/`, queue `app/api/queues/workspace/reservation-hold-cleanup`, daily cron `app/api/cron/workspace/reservation-holds` |
| Paid fulfillment | `features/checkout/backend/fulfillment/`, queue `app/api/queues/workspace/paid-fulfillment`, daily cron `app/api/cron/workspace/paid-fulfillment` |
| Email delivery webhook | `app/api/webhooks/resend/route.ts`, `features/checkout/backend/fulfillment/resend-webhook.service.ts` |

Cron schedules are in `vercel.json`. Queue payloads are versionless; evolve their strict decoders directly and never add `schemaVersion`.

## Data ownership and PII

Dotypos owns customer and reservation facts. Nexi owns external payment facts. The local database is a workflow, payment, legal, and recovery ledger:

- Store only `dotypos_customer_id` and `dotypos_reservation_id`; read Dotypos for reservation facts.
- `author_account_id` names the reservation author, the signed-in customer account whose submission created or resumed the reservation; guest drafts store null. A superseding replacement records the account that submitted it. A signed-in submission that reuses an authorless draft assigns the account as author; a draft another account authored isn't reused (`CheckoutAttemptUnavailableError`). Payment does not establish or change authorship, so an authorless legacy reservation stays authorless until the #682 backfill. The domain skill's [reservation parties](../../deskohub-workspace-domain/references/reservation-parties.md) reference defines author and customer; the account skill's [durable customer account](../../deskohub-workspace-account/references/account-domain-and-routes.md#durable-customer-account) section covers storage.
- Never persist customer name, email, phone, free-form notes, payment instrument data, Nexi `customerInfo`, or raw provider payloads, in any column, JSON, event text, or log. The one exception is the encrypted accounting snapshot ([accounting-documents.md](accounting-documents.md)).
- Allowed: Dotypos and Deskohub IDs, HMAC checkout keys, provider order and operation IDs, active email delivery IDs, Nexi `securityToken` (on `payment_attempts` only), legal document paths and hashes, state enums, timestamps, normalized failure codes, amounts, currencies, and quote fingerprints.
- Server actions hold PII in memory only to find or create the Dotypos customer and derive transient key payloads. Nexi HPP creation may send the signed customer name, email, and phone as `order.customerInfo`; adapters never log or persist them.
- Shape repository inputs so PII has no destination field. `jsonb` schemas exclude contact fields, notes, and raw provider envelopes.
- Wrap every confidential SQL scalar with `sensitiveDatabaseParameter`; structured parameters pass through the shared recursive censor.
- A new column or JSON field that can carry customer-authored free text needs a separate privacy review.
- Never recreate a `checkout_return_state_tokens` table. Return pages derive context from signed URL state, route parameters, Nexi verification, and the durable rows.
- Administration reads current Nexi orders on demand and exposes only allowlisted fields; it persists no provider snapshot.

Discount and voucher tables (`discounts`, `discount_targets`, `promotion_codes`, `discount_codes`, `vouchers`, `discount_applications`, the redemption ledgers, and their customer-audience tables) hold only source-neutral configuration, Dotypos customer IDs, application snapshots, and claim state. `promotion_codes` is the one submitted-code namespace; discount codes and vouchers keep separate aggregates and claim ledgers. Operator mutations are in the administration skill's [discount reference](../../deskohub-workspace-administration/references/discounts.md).

Customer marketing consent lives in `customer_marketing_consents`, one row per Dotypos customer. A checked box grants or reactivates it; an unchecked box is a no-op, never a withdrawal. Reservation terms acceptance is append-only in `legal_evidence_events` with source `payment_submit`. When one control captures both the early-performance request and the withdrawal-right acknowledgement, persist one consent fact, not one boolean per legal label.

## State machines

State types and check constraints are in `db/schema`. Repositories guard every transition with the expected prior state.

### Reservation state

- `draft -> creating_hold -> held`; `creating_hold -> draft` only if Dotypos failed before returning an ID; `creating_hold -> cancellation_failed` if the hold exists but local attach or cancel fails.
- `held -> confirming -> confirmed` after verified payment.
- `held -> hold_expired -> cancelling -> cancelled` for expired unpaid holds; `held -> cancelling -> cancelled` for an unsuccessful terminal payment.
- `cancelling -> cancellation_failed -> cancelling`.
- `confirmed -> cancelling -> cancelled` only through operator cancellation. It keeps paid and fulfillment facts, marks paid Nexi attempts `refund_state = 'required'`, refuses while fulfillment is `processing` or `awaiting_delivery`, and requires confirmed provider removal before retiring a live or ambiguous PIN.
- Nothing leaves `cancelled`. Cleanup finalizes a cancellation only while the row is still `cancelling`, unpaid, and unconfirmed.
- Never create a second Dotypos reservation for one `checkout_attempt_key`, or a replacement in the same session before the prior local and Dotypos reservations are cancelled.
- Administration may overlay a live Dotypos `CANCELLED` status as an operator attention state when the local row is stale. Keep it read-only: it never persists a transition, authorizes access, triggers recovery, or claims Deskohub cancelled the booking.

### Payment state

- Aggregate `workspace_reservations.payment_state`: `not_started -> pending -> paid | failed | cancelled | expired`. Zero total goes `not_started | failed | cancelled | expired -> paid` atomically with inserting the internal attempt. `paid` is terminal.
- Attempt `payment_attempts.state`: `created -> pending -> paid | failed | cancelled | expired`. Internal attempts are inserted `paid`, have exactly zero amount, and no provider fields.
- Terminal aggregate updates require the active attempt ID and apply only while the aggregate is `pending` on a `held` reservation. Update attempt and aggregate in one transaction; a retry may reapply a matching pair as a no-op but never leaves one side terminal.
- A verified unsuccessful notification whose guard fails (attempt already expired locally or no longer active) is accepted and marked processed without change. Keep a failed paid-transition guard retryable: a later delivery may route it to late-payment recovery.
- A new attempt after a failed, cancelled, or expired one is allowed only while the reservation is `held` and its hold deadline is valid.
- Only the late-payment recovery transaction may promote a failed, cancelled, or expired attempt to `paid`.

### Refund state

`payment_attempts.refund_state` is the single source of refund work: `not_required`, `required`, or `refunded`. The attempt stays `paid` throughout. A recovery flow that ends in refund marks the same attempt `required` atomically; never add a competing refund queue.

### Fulfillment state

- `not_started -> processing -> awaiting_delivery | fulfilled | failed`; `awaiting_delivery -> fulfilled | failed`; `failed -> processing`.
- `fulfilled -> failed` only for a matching failure or bounce event strictly newer than `fulfilled_at`.
- `failed -> fulfilled` only with failure code `fulfillment_email_failed` and a matching delivered event strictly newer than `fulfillment_failed_at`.
- Fulfillment runs only when `payment_state = 'paid'`.

## Checkout session and attempt keys

- `checkoutSessionId` groups the rows created while a customer moves between Reservation and Pay. It survives deliberate resubmission.
- `checkoutAttemptId` identifies one mounted-form submission and its immediate transport retries. A changed value or new mount is a new attempt.
- Neither identifies a Dotypos reservation. Only HMAC digests are stored, in `checkout_session_key` and `checkout_attempt_key`.
- The attempt key binds the normalized reservation, including contact and billing details, so replaying an opaque ID with different inputs can't reuse a hold. Marketing consent is excluded.
- Both payloads are `JSON.stringify` of a fixed object shape. Never sort keys or join a tuple.

Lookup keys survive `CHECKOUT_PAY_STATE_KEYS` rotation. Each configured key derives an HKDF subkey; new rows store the active key's `<kid>:<hex>` digest. Lookups accept every configured key's prefixed digest plus the legacy ring-keyed digest: an unprefixed hex HMAC keyed by the whole configured string. Never look up a single freshly derived key.

- Every row of a session stores the same session key. Before inserting, resolve the session's latest stored key under any accepted derivation and reuse it.
- Draft creation runs in one transaction behind `pg_advisory_xact_lock` on a rotation-independent key derived from the raw session ID (`deriveCheckoutSessionLockKey`), then inserts only if neither the attempt nor the session exists under any derivation.

### Rotating `CHECKOUT_PAY_STATE_KEYS`

The value is an ordered `kid:base64url-32-byte-key` list. The first entry is active: it seals new Pay-state tokens and derives new lookup keys. Every entry opens its tokens and is accepted for lookups.

Before any change to the value, including the one-step replace below, confirm with a read-only query that no `held` row or row with `pending` payment stores an unprefixed (ring-keyed) `checkout_session_key` or `checkout_attempt_key`. Any edit to the string stops those digests matching, which breaks lookup and late-payment recovery and lets a resubmission create a duplicate hold. The same check gates removing the ring-keyed derivation from lookups.

Rotate in three complete deployments:

1. **Stage.** Append the new entry after the active one.
2. **Activate.** Once only the staged configuration serves traffic, move the new entry first.
3. **Retire.** Remove the old entry only after a read-only query finds no `held` or `pending`-payment row whose `checkout_session_key` has its prefix, and at least one Pay-state token lifetime after activation.

Never prepend a new key in one step: an old worker could neither open new tokens nor find new lookup keys.

Production stores the value as a Vercel sensitive variable that can't be read back, and every phase rewrites the whole list. Confirm the developer can supply the current entries before staging. If they can't, the only option is a one-step replace followed by a production redeploy. It breaks every open Pay page, so do it at a quiet time and only after the ring-keyed and retire checks pass. Orphaned holds still reach cleanup, which works from reservation IDs.

## Supersession

Resubmitting the reservation form from checkout never reuses or mutates a Dotypos reservation, even with unchanged values.

- An exact attempt-key match is an idempotent retry.
- Otherwise, serialize per session: claim the previous unpaid row, require live Dotypos status `NEW`, cancel it, mark the local row cancelled, and create a new local row and Dotypos reservation under the claimed row's session key. A Dotypos `CANCELLED` reservation may be finalized locally; any other status must not be deleted.
- If the previous row has pending or paid payment, isn't `NEW`, or its cancellation fails (log it), leave it to its own lifecycle and rotate the submission into a fresh checkout session.
- Every row keeps its own cleanup deadline and scheduled cleanup task. Never refresh or transfer a task.
- Reject stale Pay state unless its exact local reservation is still current for the session and live Dotypos still reports it pending. Repeat that live check immediately before creating a provider payment session.

## Nexi payment attempts

- Meeting-room checkout stays eligible after its start until its exclusive end. Check the end at reservation submission and immediately before creating any payment attempt. Returning an already-created matching active session is recovery, not initiation: return it before the end check, and never use recovery to create a replacement.
- A definitive HPP rejection marks the attempt failed and releases its claim atomically. An ambiguous failure (network, retryable, conflict, rate limit) keeps the attempt and claim so the active attempt blocks a second charge.
- Nexi has no idempotency key for `POST /orders/hpp`, and `GET /orders/{orderId}` returns no hosted page. Never resend HPP creation automatically. An attempt still `created` without a security token never showed a payment page.
- Once the pending attempt exists, HPP creation and attachment run uninterruptibly, so the action deadline ends the submit only before the attempt exists or after attachment. A retried submit reuses the attached session.

### Timeouts

Each Nexi request times out after 5 seconds in production and 30 seconds elsewhere (`getNexiRequestTimeoutMilliseconds` in `shared/backend/config/nexi.config.ts`). The sandbox can exceed 5 seconds to create a hosted page, and each timeout leaves an ambiguous `created` attempt, so test environments wait instead of retrying. Keep every deadline that wraps a Nexi call above one full request plus surrounding work:

- Pay submit: `getCheckoutSubmitDeadline` (one Calendar load, one Dotypos request, one Nexi request, and 10 seconds of overhead).
- Status refresh: one shared 40-second verification budget (`refreshVerificationBudget` in `checkout-status.service.ts`) passed to `verifyPaymentOutcome`; on expiry the page reports `provider_verification_failed` and renders stored status. If finalization returns `not_pending`, late-payment verification starts only if one full Nexi request still fits; otherwise it logs the deferral and the next webhook or refresh starts recovery. Never shorten that lookup below one full request. The account modal's status route shares this refresh.
- Webhook, queue, and cron verification keep unbounded retries inside the 300-second function limit.

### Webhook

1. Derive the event identity and insert into `webhook_events`, or load the duplicate. A processed duplicate is a no-op success.
2. Load the attempt by `provider_order_id`. Nexi marks `securityToken` optional: accept a missing token, compare a present one in constant time, and reject a mismatch (including any token for an attempt that was never issued one).
3. Verify with `GET /orders/{orderId}`. Only that verification moves payment state.
4. In one transaction, mark attempt and reservation paid and redeem the claim; then fulfill synchronously.

A checkout referral's invitation claim stores its referrer and code. Every paid transaction that redeems it (including the zero-total internal payment and late-recovery settlement) records the referral attribution, whatever the `referrals` flag says; a conflicting referrer or a cycle keeps the existing graph and never fails the payment. Lock order is in the referrals skill. The paid status page and the zero-total payment action clear the remembered referral-code cookie.

Never store the notification body, token, `customerInfo`, warnings, `additionalData`, or card data.

Status-page and cleanup reconciliation go through provider payment finalization. After marking an attempt paid, or finding a paid order whose fulfillment is `not_started` or `processing`, it enqueues one `workspace-paid-fulfillment` message with idempotency key `paid-fulfillment:<orderId>`, and fulfills inline only when the enqueue is rejected. An order already in `awaiting_delivery`, `fulfilled`, or `failed` triggers no work from the status page.

## Hold cleanup

Keep abandoned and expired hold cleanup only in the per-reservation scheduled queue task, with the daily cron as recovery. Don't add inline cleanup, sweeps, or terminal-payment cancellation fallbacks. Supersession cancellation is not cleanup.

Nexi's card HPP documents no expiry, so queued cleanup applies a 30-minute abandonment window (`features/checkout/provider-order-abandonment.ts`):

- For an attempt with a provider session, measure from `provider_order_created_at`. Before the cutoff, defer an operation-free order through the queue retry. At or after it, expire locally only if a fresh lookup shows no operations and no authorized or captured amount. Any activity stays pending for reconciliation or an operator.
- For an attempt still `created` without a security token, measure from creation. If Nexi returns 404 or an empty order, fail it with `nexi_hpp_create_unconfirmed` (only while still `created`) and release its claim before cancelling the hold. Payment activity needs operator review; an inconclusive lookup retries later.

## Late payment recovery

A verified successful payment for an already failed, cancelled, or expired local attempt starts durable recovery in `late_payment_recoveries`. Both triggers share one row: the webhook, and a status refresh whose finalization returns `not_pending` (then `webhook_event_id` is null). Recovery start locks the payment attempt before looking for an existing recovery.

1. **Reuse** the original hold only if the row is still `held`, `reservation_hold_expires_at` is more than `reusableHoldMinimumRemaining` away, no newer checkout reservation exists, and Dotypos reports `NEW` or `CONFIRMED`. Settlement rechecks the deadline under the row lock and throws `OriginalHoldNotReusableError` to continue with release in the same run. Availability treats an unpaid `held` row past its deadline as free (`selectExpiredHoldDotyposReservationIds`), so Dotypos `NEW` alone never proves the slot is still ours.
2. **Release** otherwise: claim a `held`, `hold_expired`, `cancellation_failed`, or 10-minute-stale `cancelling` row, cancel the Dotypos hold unless already `CANCELLED`, and mark it `cancelled`. Dotypos `CONFIRMED` or an unknown status requires review. A failed cancellation records `cancellation_failed` and stays retryable; a fresh `cancelling` claim owned by cleanup is waited on.
3. **Recreate** through normal reservation creation for the immutable accepted reservation and price from the accounting snapshot: ended check, `ensureAvailable`, table assignment, and a new `CONFIRMED` Dotypos reservation marked with the order reference. A replacement found by that marker from an interrupted run is reused.
4. **Settle** atomically to paid, re-redeem the released claim under the same total and per-customer limits as admission, and continue normal fulfillment.

Require a refund only when the reservation can't be provided: `WorkspaceTableUnavailableError`, `TableAssignmentUnavailableError`, ended interval, missing snapshot, newer checkout reservation, superseded attempt, operator force-cancellation, or unredeemable claim. Release the hold before settling the refund, because cleanup never selects a paid row. Ambiguous provider state requires operator review. Settlement keeps an already recorded `refunded` state and the attempt's previous `last_webhook_event_id` when the recovery has none.

Operator force-cancellation marks the active pending attempt cancelled and releases its claim first. Its stable failure reason stops recovery from recreating the booking; a later settlement requires a refund.

## Refunds

Operators refund in the Nexi back office, never through Workspace.

- Reconcile by re-reading `GET /orders/{orderId}`; never trust a notification body. Count `REFUND` operations with result `EXECUTED`, `REFUNDED`, or `VOIDED` (a pre-settlement back-office refund appears as `VOIDED`). Failed, pending, and unknown results don't count.
- Any counted refund, full or partial, moves the attempt to `refunded` with the summed amount (`refunded_amount_value`) and latest time (`refunded_at`). The recorded total only grows; a smaller or equal total is `unchanged`, and a non-paid or non-Nexi attempt is `not_applicable`. A refund recorded on a `not_required` attempt is kept.
- `verifyPaymentOutcome` ignores refund operations, so a refunded order still verifies as paid and never reaches failure or late-payment paths. A refund notification never reruns the paid transition or fulfillment.
- The hourly `/api/cron/workspace/payment-refunds` batch is the primary path. Production has received no notification for back-office refunds, though the webhook records one if it arrives.

The batch claims `required` attempts of any age plus paid Nexi attempts from the last 30 days that are `not_required` or partly refunded. It takes attempts not checked in 6 hours, never-checked first, then least recently checked (`refund_checked_at`), across both groups, and stamps every claim whatever Nexi returns, so no group starves.

The budget arithmetic is documented in the route and service. Keep these rules when you change it:

- Claim each attempt just before its lookup, and start a lookup only while one exhausting every retry (`getNexiRequestWorstCaseDuration`) still fits the budget; recheck after the claim. `releaseRefundCheck` restores the previous `refund_checked_at` only while the stamp is still this claim's.
- At the budget, interrupt all workers and release their claims with a bounded wait. Effect SQL runs connection acquisition, BEGIN, and COMMIT or ROLLBACK uninterruptibly, so `refundBatchOverrunWorstCase` derives the possible overrun from `databasePoolTimeouts`. The budget is `maxDuration` minus that overrun minus headroom.
- Lock the batch in its own `select … for update skip locked` and stamp it by ID in the same transaction. An `update … where id in (select … limit n for update skip locked)` can claim more than `n` rows, because Postgres re-runs the subquery per updated row and each run skips the rows already updated.

## Fulfillment

Paid fulfillment confirms the Dotypos reservation, issues the access PIN ([reservation-access.md](reservation-access.md)), and sends the customer confirmation with a protected access link, never the PIN.

- Recovery reclaims a stale `processing` claim after `PAID_FULFILLMENT_PROCESSING_RETRY_AFTER_MS` but never reclaims `awaiting_delivery`.
- The queue consumer fails a message for redelivery while fulfillment is still `not_started` or `processing`. The daily paid-fulfillment cron covers orders stuck there over 15 minutes outside unrecovered late-payment recovery; re-enqueueing can't, because the per-order idempotency key dedupes it. The cron takes the least recently updated orders first, and a claim bumps `updatedAt`, so a repeatedly failing order rotates behind untried ones.

### Email delivery

In production, when the provider accepts the customer send, record its non-PII delivery ID in `active_customer_email_delivery_id` and move to `awaiting_delivery`. A delivery webhook applies only when its email ID matches the recorded ID and its event time is strictly newer than the timestamp guarding the current outcome; older or equal events are no-ops.

Outside production, and whenever Console accepted the send (an `EMAIL_TEST_DOMAIN` customer; Console never reports delivery), fulfillment completes on acceptance. Protected preview deployments can't receive provider callbacks reliably. The internal notification is best effort; a test-recipient customer's copy goes to the synthetic internal mailbox, and outside production its subject carries `[TESTING]`.

- `active_customer_email_delivery_locale` pins the locale for one confirmation generation: set only while null, before the first send, and cleared when the accepted delivery ID is recorded.
- Retrying a delivery failure keeps the failed send's ID while fulfillment is reclaimed into `processing`; the ID marks the recovery generation. The recovery send derives its idempotency key from that ID, so the provider can't replay the bounced send, and the key stays stable across retries of the same recovery. Each accepted send replaces the stored ID and starts a new generation. Initial sends use the reservation-and-category key.
