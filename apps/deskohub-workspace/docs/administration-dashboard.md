# Workspace administration

## Purpose

Workspace administration helps authorized operators find reservations and customers, understand a reservation's current condition and history, manage discounts and sales, and control issued administration sessions.

The primary navigation includes Overview, Reservations, Customers, Invoices, Codes, Vouchers, Sales, and CLI sessions. Payment and booking records appear in the reservation that owns them instead of competing as separate primary workflows.

## Invoice administration

Administration shows order and ad-hoc invoices in one sortable, paginated history. Without an explicit sort, documents needing a delivery retry appear first and the remainder are newest first. An explicit sort is respected without adding the attention grouping. Each invoice has an embedded immutable PDF, download action, provenance, and retry action that sends only missing, failed, or stale customer or internal deliveries.

Reservation invoices are shown as paid. An operator can also mark an ad-hoc invoice as already paid and record its payment date. Paid invoices omit payment instructions. Positive-total unpaid ad-hoc invoices are shown as issued before their due date, due on that date, and overdue afterwards, using the current Prague calendar date. Zero-total and negative-total unpaid documents remain issued because they do not request payment. Email delivery is shown separately as sending, sent, or needing a resend.

An operator can issue an ad-hoc service invoice to an existing Dotypos customer or a new customer reused by exact email. Each invoice records either a due date or an already-paid date. The reviewed billing identity and delivery email are saved to Dotypos before issuance. Creation requires at least one description and signed decimal price, uses a single configured invoice currency, and records the authenticated Basic-auth username and whether the operation came from the administration UI or `dhw`. The final confirmation shows the generated PDF preview and explicitly warns that creation is immutable and immediately emails both recipients; the final invoice number and issue time are assigned only after confirmation.

## Operator responsibilities

Reading reservation and customer views does not refresh payment state, retry fulfillment, cancel a reservation, or repair an external record. Mutations belong to explicit operator workflows such as cancelling an eligible reservation, recovering reservation access, maintaining discounts, codes, sales, customer discount groups, or administration sessions. Cancellation may send the customer a localized email, preserves successful settlement facts, and atomically marks a paid Nexi attempt as needing a refund without issuing one; zero-total internal payments do not require a refund.

Discount definitions are managed through the code or sale that uses them. Creating a code may create its benefit at the same time. Historical applications and redemptions remain immutable.

## Information ownership

Administration combines:

- Workspace lifecycle, payment, discount, and milestone evidence;
- current booking and customer facts from the reservation system;
- current external payment details when available; and
- optional historical observations that help explain a journey.

An unavailable external record never hides an existing Workspace reservation. Provider identifiers remain available for support, while unavailable enrichment is shown as unavailable rather than replaced with a different local answer.

Customer contact search is protected. Contact values are not placed in shareable URLs or copied into Workspace records merely to support search. Filters may use non-sensitive identifiers, dates, reservation families, and business statuses.

Secret Workspace access codes, payment security values, payment redirect addresses, free-form provider notes, and raw provider or analytics payloads are excluded from administration projections. Reservation access state, validity, device, provider credential identifier, and failure metadata are visible without the code itself.

A definitively failed access issuance can be retried. An uncertain issuance can be retried only after an operator uses the Igloohome app over Bluetooth at the lock to remove the named credential or verify that it is absent, then explicitly confirms that cleanup. If cleanup cannot be confirmed, the possible credential must be allowed to expire instead of creating another one.

A provisioning attempt that remains incomplete for one minute is treated as equally ambiguous and follows the same manual cleanup workflow. A current provisioning attempt cannot be reconciled while it may still be completing.

## Reservation presentation

A reservation presents an actual-state journey through Started, Held, Paid, and Complete, or an exact cancellation condition such as Hold expired, Cancelling, Cancellation issue, or Cancelled.

Operator cancellation is available for a held, confirmed, or retryable failed-cancellation reservation while payment is not pending and fulfillment is not actively processing. It cancels the current Dotypos booking and records the local reservation as cancelled while preserving payment, fulfillment, discount, legal, and accounting history. Customer email delivery happens only after cancellation succeeds; an email failure is reported separately and never misrepresents the booking as active.

Payment failure alone does not make a still-held reservation cancelled. A paid reservation with incomplete or failed fulfillment is not shown as complete. If the reservation system reports cancellation while Workspace is stale, administration may show a separate attention warning without rewriting Workspace history or claiming that recovery completed.

Provider-payment cleanup outcomes remain explicit. An empty Nexi order inside the local payment window is shown as waiting until its cutoff. A held reservation whose provider outcome could not be confirmed is flagged for payment review, while an operation-free order abandoned after the cutoff is shown as abandoned with its hold released. If Nexi reports payment after that release, administration shows recovery in progress, recovered, refund required, or recovery review according to the durable recovery result. A refund-required recovery and an operator cancellation both mark the affected paid Nexi attempt in the same refund-work state.

Customer summaries and overview counts must say when current external facts are unavailable. They must not substitute a local measure that answers a different question.
The customer detail summary shows a full-width activity chart for the 365 Prague calendar dates ending today. It counts every Workspace-linked reservation once on its Dotypos start date, including reservations scheduled for today, and reports the chart as unavailable when those booking dates cannot be loaded. Cowork tiers use distinct green shades; meeting-room and office reservations override cowork colors on shared dates.
Overview activity counts show completed Workspace reservations first, followed by all linked live reservations in the period, including cancelled and new reservations.

Overview customer activity covers the seven Prague calendar days ending today. Unique customers are distinct customers on live Dotypos bookings that start in the period and link to a Workspace reservation. New customers are customers referenced by Workspace whose Dotypos customer record was created in the period. Each metric shows up to three customer names. When the total exceeds three, it shows two names and the remaining count. If current booking dates or customer creation times are unavailable, the affected metric is unavailable rather than replaced with a local estimate.

## History limitations

The reservation timeline is an operational reconstruction, not an audit record. It may combine durable milestones with best-effort external or analytical observations, and those observations can be incomplete or unavailable.

Current Workspace lifecycle state remains the canonical filterable status. Only evidence explicitly defined as immutable—such as accepted discounts, redemptions, legal evidence, or issued accounting documents—may be presented as audit-quality history.

Bulk actions, customizable dashboards, and advanced query syntax are outside the current operator workflow.
