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

Any difference between adjacent boundaries returns `pricing_changed` with the affected product keys. Never introduce a newly available automatic discount retrospectively. Discount-code entry is a separate order-summary form whose field errors leave the existing summary payable. Never create a durable payment attempt or external provider session unless the freshly affirmed fingerprint and total exactly match the signed summary and all application/claim mutations commit atomically.
