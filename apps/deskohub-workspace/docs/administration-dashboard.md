# Workspace administration dashboard

The Workspace administration dashboard is a read-oriented operational view for reservations, customers, codes, discounts, calendar sales, and their related payment records. Its reservation and customer pages do not mutate checkout state, refresh payment state, retry fulfillment, or repair provider records.

The visible navigation is intentionally limited to Overview, Reservations, Customers, Codes, and Sales. Bookings, Nexi orders, and Nexi operations are shown in the reservation that owns them instead of competing as separate operator workflows. The old provider-oriented routes remain available as diagnostic fallbacks for records that cannot be linked to a Workspace reservation, but they are not part of the primary navigation.

Discount definitions are managed through the code or Calendar sale that uses them instead of through a standalone definitions table. Code creation can create its discount atomically, and associated Calendar-sale rows expose their discount editor. `/admin/discounts` redirects to Codes for compatibility with existing links.

## Data ownership

The dashboard composes three sources without creating a second customer or reservation store:

- Workspace Postgres defines which reservations belong to Workspace and supplies current workflow state, durable milestone timestamps, payment attempts, and applied-discount snapshots.
- Dotypos supplies current booking dates and customer contact details. A missing or unavailable Dotypos record does not hide an existing Workspace reservation.
- Nexi supplies live order and operation details when an order ID is linked to a local payment attempt. Provider IDs remain visible and link directly to XPay even when Nexi is unavailable.
- PostHog can add selected historical lifecycle observations to an individual reservation timeline. It never determines the current status and is not queried for reservation or customer lists.

Fuzzy customer search by name or email remains a protected server action. Customer contact data is not placed in URLs or persisted by the dashboard. The selected Dotypos customer ID, status groups, reservation types, dates, and page numbers may be represented in URLs.

The administration projection deliberately excludes Workspace access codes, payment security tokens, provider redirect URLs, Dotypos notes, raw provider responses, and raw PostHog property bags.

## Reservation lifecycle

The lifecycle diagram is a projection of the selected reservation, not a generic explanation. It combines the local reservation state, payment-attempt state, and fulfillment outcome into Started, Held, Paid, Complete, or the exact cancellation substate (Hold expired, Cancelling, Cancellation issue, or Cancelled). A live Dotypos `CANCELLED` status is overlaid as an attention-state cancellation when the local row is stale, because Dotypos owns the current booking fact. This read-only overlay never writes a local transition or authorizes repair. A failed or expired payment does not by itself mark a still-held reservation as cancelled, and an in-progress or failed release is never presented as complete. The chronological history below the diagram shows the durable local milestones plus any available Nexi and PostHog observations.

The Overview activity counts use live Dotypos booking start dates intersected with the reservations known to Workspace. If Dotypos is unavailable, the affected count is shown as unavailable rather than replaced with a locally derived value that answers a different question.

## PostHog history configuration

Historical analytics enrichment is optional. Configure all three server-only variables to enable it:

- `POSTHOG_HOST`
- `POSTHOG_PROJECT_ID`
- `POSTHOG_HISTORY_API_KEY`

The host and project ID are shared with the existing PostHog setup. The history API key must be a dedicated least-privilege personal API key with `query:read`. Do not reuse the public ingest token or the API key used for source-map upload.

Queries are limited to the app-owned reservation lifecycle event names, the local Workspace reservation ID, the current deployment environment, and the Workspace service name. Only normalized event name, time, event identifier, payment-attempt identifier, and provider are decoded; React never receives the raw event object.

If the configuration is absent, PostHog is slow, or the response cannot be decoded, the reservation page continues to show durable Workspace milestones without interrupting the operator view.

## Visibility, not auditability

The timeline is an operational reconstruction, not an audit record. This limitation is documented here instead of repeated in the operator interface. Auditability would require an immutable event ledger with explicit retention, integrity, and access guarantees.

The current history can be incomplete because:

- lifecycle analytics capture is best-effort and capture failures are swallowed;
- only selected milestones emit analytics events;
- cancelled and expired payments share the same analytics observation;
- analytics retention or deletion can remove older observations;
- analytics events do not provide complete actor, source, reason, previous-state, or new-state attribution;
- current Workspace rows store current state and selected milestone timestamps, not every transition;
- the non-production direct-fulfillment path does not emit the same fulfillment event as the production delivery path.

Workspace lifecycle state remains the canonical, filterable status. The operator presentation may overlay a live Dotypos cancellation to expose a stale local hold, but that display does not persist a transition, authorize customer access, trigger recovery, or prove that Deskohub completed cancellation. PostHog observations never determine current status.

Bringing reservation lifecycle history up to auditability requires a durable append-only domain transition stream written transactionally with the state change. Each transition should include a stable event ID, reservation ID, previous and new states, occurrence time, normalized reason, actor or source, correlation and causation IDs, and schema version. Delivery to PostHog should happen through an outbox with retry and delivery status. A complete audit design must also define retention, tamper evidence, access logging, redaction, repair, and backfill policy while preserving the no-PII boundary.

## Known adjacent lifecycle debt

The checkout lifecycle documentation says Workspace access codes must not be stored locally, while the current `workspace_reservations` schema still contains a `customer_access_code` column. The administration projection excludes that column entirely. Removing the existing storage is a separate checkout migration and should be handled under the checkout lifecycle invariants.

The schema and lifecycle documentation also define `hold_expired` and `confirming`, while current transition writers appear to skip those intermediate reservation states. The dashboard handles both states exhaustively but does not invent or repair transitions.
