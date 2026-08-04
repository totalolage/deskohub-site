# Workspace administration dashboard

The Workspace administration dashboard is a read-oriented operational view for reservations, customers, discounts, codes, and calendar sales. Its reservation and customer pages do not mutate checkout state, refresh payment state, retry fulfillment, or repair provider records.

## Data ownership

The dashboard composes three sources without creating a second customer or reservation store:

- Workspace Postgres defines which reservations belong to Workspace and supplies current workflow state, durable milestone timestamps, payment attempts, and applied-discount snapshots.
- Dotypos supplies current booking dates and customer contact details. A missing or unavailable Dotypos record does not hide an existing Workspace reservation.
- PostHog can add selected historical lifecycle observations to an individual reservation timeline. It never determines the current status and is not queried for reservation or customer lists.

Fuzzy customer search by name or email remains a protected server action. Customer contact data is not placed in URLs or persisted by the dashboard. The selected Dotypos customer ID, status groups, reservation types, dates, and page numbers may be represented in URLs.

The administration projection deliberately excludes Workspace access codes, payment security tokens, provider redirect URLs, Dotypos notes, raw provider responses, and raw PostHog property bags.

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

Workspace lifecycle state is the canonical, filterable current status. Neither Dotypos nor PostHog observations may override it, authorize customer access, trigger recovery, or prove that a transition occurred.

Bringing reservation lifecycle history up to auditability requires a durable append-only domain transition stream written transactionally with the state change. Each transition should include a stable event ID, reservation ID, previous and new states, occurrence time, normalized reason, actor or source, correlation and causation IDs, and schema version. Delivery to PostHog should happen through an outbox with retry and delivery status. A complete audit design must also define retention, tamper evidence, access logging, redaction, repair, and backfill policy while preserving the no-PII boundary.

## Known adjacent lifecycle debt

The checkout lifecycle documentation says Workspace access codes must not be stored locally, while the current `workspace_reservations` schema still contains a `customer_access_code` column. The administration projection excludes that column entirely. Removing the existing storage is a separate checkout migration and should be handled under the checkout lifecycle invariants.

The schema and lifecycle documentation also define `hold_expired` and `confirming`, while current transition writers appear to skip those intermediate reservation states. The dashboard handles both states exhaustively but does not invent or repair transitions.

## Synthetic local review

Set `ADMIN_PREVIEW_FIXTURES=true` only with `NODE_ENV=development` to render obviously synthetic reservation and customer examples for visual review and screenshots. The mode cannot activate in production builds. It bypasses local Basic authentication only for fixture-backed `GET` pages under the overview, reservations, and customers sections. Discount, code, and sales pages, Server Actions, and every live data operation remain protected.
