---
name: deskohub-workspace-checkout
description: Change or review Deskohub Workspace checkout, payment, reservation holds, scheduled cleanup queue tasks, or daily cron recovery behavior while preserving lifecycle invariants.
---

# Deskohub Workspace checkout

Keep reservation-hold cleanup exclusively in the per-reservation scheduled queue task, with the daily cron job as the recovery path. Do not add inline cleanup, sweep, or terminal-payment cancellation fallbacks.

Inspect the [checkout lifecycle](../../../apps/deskohub-workspace/docs/checkout-lifecycle.md), [scheduled cleanup queue route](../../../apps/deskohub-workspace/app/api/queues/workspace/reservation-hold-cleanup/route.ts), and [daily recovery cron route](../../../apps/deskohub-workspace/app/api/cron/workspace/reservation-holds/route.ts) before changing this boundary. Update this skill when developer feedback adds or changes a durable checkout invariant.

Preserve the three price boundaries documented in the checkout lifecycle:

- reservation-page advertisement;
- signed order-summary quote;
- freshly affirmed payment amount.

Any change to price facts accepted at the immediately preceding boundary returns `pricing_changed` with the affected product keys. Never introduce a newly available anonymously discoverable automatic discount retrospectively. Discount-code entry is a separate order-summary form whose field errors leave the existing summary payable. Never create a durable payment attempt or external provider session unless the freshly affirmed fingerprint and total exactly match the signed summary and all application/claim mutations commit atomically.

Reservation-page advertisement evaluates only anonymously discoverable automatic discounts, currently Calendar sales. Customer-specific pricing is outside that boundary by contract; do not add an inert snapshot field merely to restate that it was not evaluated. After advertised discounts are affirmed on reservation submission, the customer discount may first appear in the signed summary following Dotypos identity resolution without `pricing_changed`. This is the only automatic-discount exception at that boundary. Once shown, the customer discount follows the normal affirmation and `pricing_changed` rules.

Inside `apps/deskohub-workspace`, do not prefix new app-owned services, operations, or supporting types with `Workspace`; the app boundary already supplies that context. Keep the prefix only when it distinguishes a real alternative or belongs to an established contract whose broad rename is outside the current change.

Keep catalog currency through advertisement, signed-summary generation, and final price affirmation. The non-production Nexi sandbox currency override belongs only at provider-session creation: apply it to the amount sent to Nexi and persisted on the provider attempt, without feeding it back into any customer-visible quote.
