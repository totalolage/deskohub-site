# Workspace product

<!-- impeccable:product-schema 1 -->

## Users

Deskohub customers discover and reserve cowork, meeting-room, and office products. Deskohub operators maintain availability, discounts, sales, and the operational configuration used by reservation and checkout flows.

## Purpose

Workspace lets customers understand the offer, see an accurate price, reserve suitable capacity, pay when required, and receive the information needed to use the space. Its administration surfaces let authorized operators manage configuration and understand the current condition of a reservation without changing historical customer commitments.

## Product commitments

- Preserve the price, product, discount labels, and legal terms that a customer accepted.
- Keep customer and reservation facts in their designated operational systems rather than building competing records.
- Show a changed price for renewed acceptance before payment begins.
- Keep configuration failures isolated so one malformed discount or schedule does not suppress unrelated valid offers.
- Protect customer contact, billing, payment, and access information from unnecessary storage or operator exposure.
- Preserve immutable evidence of completed payments, accepted discounts, redemptions, legal acceptance, and issued accounting documents.

## Operating model

- Product availability reflects current reservations and business-calendar limitations.
- Sales schedules and discount definitions have separate ownership so timing can change without rewriting the customer-facing benefit.
- Discounts may be automatic, customer-specific, or deliberately entered as a code.
- Reservation holds are temporary until payment or a zero-price completion succeeds.
- Failed or abandoned payment must not leave capacity held indefinitely.
- Administrative history is operational visibility unless a workflow explicitly defines immutable audit evidence.

## Product principles

- Prefer a small, direct customer and operator workflow.
- Fail safely when configuration is invalid or current facts cannot be verified.
- Never silently substitute a materially different price, product, or reservation.
- Treat external systems as unavailable without hiding the Workspace record that operators still need to understand.
