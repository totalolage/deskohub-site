---
name: deskohub-workspace-checkout
description: Change or review Deskohub Workspace checkout, payment, reservation holds, scheduled cleanup queue tasks, or daily cron recovery behavior while preserving lifecycle invariants.
---

# Deskohub Workspace checkout

Keep abandoned and expired reservation-hold cleanup exclusively in the per-reservation scheduled queue task, with the daily cron job as the recovery path. Do not add inline abandonment cleanup, sweeps, or terminal-payment cancellation fallbacks. Deliberately cancelling an unpaid reservation because the customer resubmitted the reservation form is supersession, not cleanup.

Do not reuse or mutate a Dotypos reservation when the reservation form is resubmitted from checkout, even when its values are unchanged. Cancel the existing unpaid reservation, preserve its local row and Dotypos reservation ownership, then use the normal flow to create a new local row and a new Dotypos reservation. Each reservation keeps its own scheduled cleanup task; never refresh or transfer the old task. If the existing reservation has a pending or paid payment, leave it untouched and rotate the current submission into a fresh checkout session. If supersession cancellation fails, log and retain the old row for scheduled recovery, then likewise rotate the session before continuing.

Use `checkoutSessionId` for the stable grouping and back-navigation lifetime across reservation edits. Use `checkoutAttemptId` for one mounted form submission and its immediate transport retries; bind its stored HMAC to the normalized submitted values so replaying the opaque ID with different inputs cannot reuse a hold. Neither identifies a Dotypos reservation. Serialize supersession for a checkout session, and reject stale pay state unless its exact local reservation is still current for that session and its live Dotypos reservation remains pending rather than cancelled. Before supersession deletion, likewise require live Dotypos status `NEW`; an already `CANCELLED` reservation may be finalized locally, while any other status must not be deleted. Repeat the live Dotypos-state guard immediately before creating a provider payment session so a cancellation between page rendering and payment submission cannot start payment for a stale reservation.

Inspect the [checkout lifecycle](../../../apps/deskohub-workspace/docs/checkout-lifecycle.md), [scheduled cleanup queue route](../../../apps/deskohub-workspace/app/api/queues/workspace/reservation-hold-cleanup/route.ts), and [daily recovery cron route](../../../apps/deskohub-workspace/app/api/cron/workspace/reservation-holds/route.ts) before changing this boundary. Update this skill when developer feedback adds or changes a durable checkout invariant.

Preserve the three price boundaries documented in the checkout lifecycle:

- reservation-page advertisement;
- signed order-summary quote;
- freshly affirmed payment amount.

Any change to price facts accepted at the immediately preceding boundary returns `pricing_changed` with the affected product keys. Never introduce a newly available anonymously discoverable automatic discount retrospectively. Discount-code entry is a separate order-summary form whose field errors leave the existing summary payable. Never create a durable payment attempt or external provider session unless the freshly affirmed fingerprint and total exactly match the signed summary and all application/claim mutations commit atomically.

Treat a created payment attempt's provider-start lease as ownership, not merely as a timeout. A definitive provider-start failure may terminalize only the exact, still-unexpired lease by database clock; an expired owner must not change or replace that lease or an attached provider session. Nexi HPP creation has no documented idempotency contract, so execute its state-creating POST exactly once for each durable attempt and never retry or repeat it after an ambiguous exit. Configure the native provider Fetch transport with redirects rejected: a 307/308 can otherwise replay the POST and forward its credential, and redirect rejection is an ambiguous exit. A durable `created` attempt means that POST may already have reached Nexi. After its lease expires, reconcile the stable provider order with a read-only lookup; reconcile all order, amount, currency, token, status, and relevant-operation evidence collectively. Multiple operations, conflicting facts, or success followed by terminal evidence require manual review and must never settle automatically. A remotely unambiguous terminal result may settle the unattached attempt, while pending, unavailable, mismatched, or otherwise unverified state remains unresolved and must not be expired by hold cleanup. Only the local attach operation may be retried, and it must accept only an exact idempotent match. Admission rollout gates block only new attempts and must not block reuse or stable-order reconciliation for an already-admitted attempt.

Treat the unauthenticated webhook only as a trigger for an authoritative read-only
provider lookup. Every webhook operation field is delivery-local evidence and
must agree with the admitted order/amount/currency and the lookup's actual
operation ID, type, result, amount, and currency before that delivery may
settle. A forged token or unsigned operation contradiction leaves only that
delivery unprocessed; it must never create a durable provider-evidence conflict
or poison a later clean reconciliation. Durable conflict fencing requires
authenticated lookup evidence that contradicts local or existing durable
evidence, or contradictions within the lookup itself. Never invent an operation
ID from an order ID. Prior-writer v1 recovery may reuse an attached session or
reconcile a `created` attempt only when its persisted amount and complete
ordered discount applications exactly match the accepted pricing; v1 ambiguity
is read-only and must never issue another HPP POST.

Never annotate or log raw HPP requests, provider responses, hosted-page URLs, session credentials, or local attach failures. Emit only explicit safe projections at the adapter boundary, and keep shared censorship for `hostedPage`, HPP URL, payment-session URL, provider redirect, credential, raw error, SQL-bind aliases, and Effect `Cause` failures/defects as defense in depth across console, OpenTelemetry, traces, and analytics. Dedicated logger cause fields must be rebuilt from censored reason projections before any sink.

Paid-event durability must cover mixed-version writers at the database boundary. Keep idempotent paid-transition triggers and the consistent-pair backfill/reconciliation contract until every old writer is drained and the missing/invalid verification counts are zero. Keep database rollback fences that reject legacy terminal cleanup of active v2 `created` and `pending` attempts until new admission is disabled, all such attempts are reconciled, and the exact writer-version drain is proved. Contradictory terminal state, failure code, provider operation, or provider status replays are lifecycle conflicts, not idempotent success. Persist only normalized provider-evidence conflict codes for manual review; never persist raw provider evidence in that audit path.

Treat any durable provider-evidence conflict row as a permanent automatic-settlement fence for that payment attempt. Conflict recording, paid settlement, unsuccessful-terminal settlement, provider-start failure, attachment, admission reuse, and attempt replacement must serialize on the exact attempt lock or its database-materialized reservation fence. Preserve the conflicted attempt as active; no automatic path may relink the reservation or create a second provider order. Paid or terminal replay must fail for manual review before changing the attempt, reservation, claim, paid-event handoff, or fulfillment. Direct reconciliation must load the exact active attempt and verify provider evidence before taking any already-paid or already-terminal shortcut, so opposing terminal evidence cannot be hidden by aggregate state.

Reservation-page advertisement evaluates only anonymously discoverable automatic discounts, currently Calendar sales. Customer-specific pricing is outside that boundary by contract; do not add an inert snapshot field merely to restate that it was not evaluated. After advertised discounts are affirmed on reservation submission, the customer discount may first appear in the signed summary following Dotypos identity resolution without `pricing_changed`. This is the only automatic-discount exception at that boundary. Once shown, the customer discount follows the normal affirmation and `pricing_changed` rules.

Inside `apps/deskohub-workspace`, do not prefix new app-owned services, operations, or supporting types with `Workspace`; the app boundary already supplies that context. Keep the prefix only when it distinguishes a real alternative or belongs to an established contract whose broad rename is outside the current change.

Pass canonical reservation projections through pricing boundaries. Do not repair an incomplete checkout product type by manually intersecting reservation fields such as `date`; use the reservation domain's existing PII-free details projection.

Keep catalog currency through advertisement, signed-summary generation, final price affirmation, and local payment attempts. The non-production Nexi sandbox currency override belongs only at Nexi call sites: apply it to HPP creation and verification arguments without feeding it back into customer-visible quotes or locally persisted payment facts.

Discount-code submission and price-change metadata are reservation-family-neutral. Keep `submittedCode` and `changedKeys` in the common signed pay-state envelope, and have every reservation family quote and affirm discounts through its own canonical product identity. Exhaustively dispatch family-owned quote, summary, persistence, and checkout-details projections; do not make cowork the implicit default.

Do not add temporary downstream reservation-family rejection guards when the public issuing schema cannot produce that family. Keep reachability at the issuer boundary and let the PR that opens the issuer implement the new family exhaustively; transitional guards are easy to forget and can silently block the completed feature.
