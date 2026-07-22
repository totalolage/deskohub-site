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

Reservation-page advertisement evaluates only anonymously discoverable automatic discounts, currently Calendar sales. Customer-specific pricing is outside that boundary by contract; do not add an inert snapshot field merely to restate that it was not evaluated. After advertised discounts are affirmed on reservation submission, the customer discount may first appear in the signed summary following Dotypos identity resolution without `pricing_changed`. This is the only automatic-discount exception at that boundary. Once shown, the customer discount follows the normal affirmation and `pricing_changed` rules.

Inside `apps/deskohub-workspace`, do not prefix new app-owned services, operations, or supporting types with `Workspace`; the app boundary already supplies that context. Keep the prefix only when it distinguishes a real alternative or belongs to an established contract whose broad rename is outside the current change.

Pass canonical reservation projections through pricing boundaries. Do not repair an incomplete checkout product type by manually intersecting reservation fields such as `date`; use the reservation domain's existing PII-free details projection.

Keep catalog currency through advertisement, signed-summary generation, and final price affirmation. The non-production Nexi sandbox currency override belongs only at provider-session creation: apply it to the amount sent to Nexi and persisted on the provider attempt, without feeding it back into any customer-visible quote.
