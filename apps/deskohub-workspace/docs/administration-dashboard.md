# Workspace administration

## Purpose

Workspace administration helps authorized operators find reservations and customers, understand a reservation's current condition and history, manage discounts and sales, and control issued administration sessions.

The primary navigation is limited to Overview, Reservations, Customers, Codes, and Sales. Payment and booking records appear in the reservation that owns them instead of competing as separate primary workflows.

## Operator responsibilities

Reservation and customer views are observational. Viewing them does not refresh payment state, retry fulfillment, cancel a reservation, or repair an external record. Mutations belong to explicit operator workflows such as maintaining discounts, codes, sales, customer discount groups, or administration sessions.

Discount definitions are managed through the code or sale that uses them. Creating a code may create its benefit at the same time. Historical applications and redemptions remain immutable.

## Information ownership

Administration combines:

- Workspace lifecycle, payment, discount, and milestone evidence;
- current booking and customer facts from the reservation system;
- current external payment details when available; and
- optional historical observations that help explain a journey.

An unavailable external record never hides an existing Workspace reservation. Provider identifiers remain available for support, while unavailable enrichment is shown as unavailable rather than replaced with a different local answer.

Customer contact search is protected. Contact values are not placed in shareable URLs or copied into Workspace records merely to support search. Filters may use non-sensitive identifiers, dates, reservation families, and business statuses.

Workspace access codes, payment security values, payment redirect addresses, free-form provider notes, and raw provider or analytics payloads are excluded from administration projections.

## Reservation presentation

A reservation presents an actual-state journey through Started, Held, Paid, and Complete, or an exact cancellation condition such as Hold expired, Cancelling, Cancellation issue, or Cancelled.

Payment failure alone does not make a still-held reservation cancelled. A paid reservation with incomplete or failed fulfillment is not shown as complete. If the reservation system reports cancellation while Workspace is stale, administration may show a separate attention warning without rewriting Workspace history or claiming that recovery completed.

Customer summaries and overview counts must say when current external facts are unavailable. They must not substitute a local measure that answers a different question.

## History limitations

The reservation timeline is an operational reconstruction, not an audit record. It may combine durable milestones with best-effort external or analytical observations, and those observations can be incomplete or unavailable.

Current Workspace lifecycle state remains the canonical filterable status. Only evidence explicitly defined as immutable—such as accepted discounts, redemptions, legal evidence, or issued accounting documents—may be presented as audit-quality history.

Bulk actions, customizable dashboards, and advanced query syntax are outside the current operator workflow.
