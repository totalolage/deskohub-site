---
name: deskohub-workspace-checkout
description: Workspace checkout, reservation submission, agent booking view, MCP Apps, Pay page, order summary, pricing_changed, discount affirmation, Nexi payment, webhook, late payment, refund, reservation hold, supersession, hold cleanup, paid fulfillment, access PIN, availability cache, invoice, accounting snapshot.
---

# Deskohub Workspace checkout

Read the reference for the part you're changing:

- Advertised prices, signed summaries, discount affirmation, `pricing_changed`, discount codes, Calendar booking instant and deadlines, currency: [references/pricing.md](references/pricing.md).
- Reservation-page availability and caching, page preload, account card, Pay tab handling, return route, status page: [references/checkout-pages.md](references/checkout-pages.md).
- Agent booking view, MCP Apps `ui://` resources, `show_booking`, tool `_meta`, booking mode: [references/agent-booking-view.md](references/agent-booking-view.md).
- Tables, PII rules, state machines, checkout keys and key rotation, supersession, Nexi attempts and timeouts, webhook, hold cleanup, late payment, refunds, fulfillment and email delivery: [references/lifecycle.md](references/lifecycle.md).
- Access PIN disclosure and Igloohome issuance: [references/reservation-access.md](references/reservation-access.md).
- Accounting snapshots, invoices, billing details, snapshot keys: [references/accounting-documents.md](references/accounting-documents.md).

Customer and operator policy lives in the business specifications: [checkout](../../../apps/deskohub-workspace/docs/checkout-lifecycle.md), [discount codes](../../../apps/deskohub-workspace/docs/discount-codes.md), and [accounting documents](../../../apps/deskohub-workspace/docs/accounting-document-snapshots.md). Change the specification when policy changes, and keep its rules out of these references.

## Always apply

- Inside `apps/deskohub-workspace`, don't prefix new app-owned services, operations, or types with `Workspace`. Keep the prefix only when it distinguishes a real alternative or belongs to an established contract.
- Keep reservation-family reachability at the issuing schema. Don't add temporary downstream rejection guards for a family the issuer can't produce; the PR that opens the issuer implements the family exhaustively.
- Update the matching reference when developer feedback adds or changes a durable checkout invariant.
