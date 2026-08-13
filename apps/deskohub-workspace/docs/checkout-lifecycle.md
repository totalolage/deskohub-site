# Workspace checkout lifecycle

## Purpose

Checkout turns a customer's selected Workspace product into a temporary reservation, an accepted price, a completed payment when money is due, and a fulfilled reservation. The lifecycle must remain understandable and recoverable when a customer navigates back, retries, abandons payment, or an external service is temporarily unavailable.

## Ownership

- The reservation system owns current customer and booking facts.
- The payment provider owns external payment processing facts.
- Workspace owns the customer's checkout journey, accepted price, local payment and fulfillment status, legal evidence, and recovery decisions.
- Workspace must not become a duplicate customer profile, reservation store, payment-instrument archive, or raw provider-event archive.

## Price acceptance

Checkout has three customer commitments:

1. The reservation page advertises a price for the selected product.
2. Reservation submission produces the authoritative order summary the customer reviews.
3. Order submission freshly confirms that the accepted summary is still payable before payment starts.

The advertised price includes only adjustments that can be discovered without identifying the customer. Customer-specific pricing may first appear on the order summary after the customer has been identified. Once any discount has appeared on the summary, it becomes part of the accepted price and must be freshly confirmed like every other adjustment.

A newly available automatic discount is not added retrospectively to an existing checkout. A discount that disappears or changes produces an updated summary and asks the customer to accept the price again. No payment begins until the payable amount exactly matches the last summary the customer reviewed.

Zero-priced components may appear in the order summary without changing the price. They remain part of the reserved product even though they do not affect the advertised amount.

## Discount codes

Entering a discount code is an independent action on the order summary:

- An invalid or unavailable code is shown as a field error and leaves the existing summary payable.
- An accepted code produces a new summary for review; it does not start payment or consume the code yet.
- Capacity is reserved only when the customer proceeds with the accepted summary.
- A successful payment permanently redeems the claim. A failed, cancelled, or expired payment releases it.
- If the code or another displayed discount can no longer be honored, checkout returns an updated summary before any payment session is created.

## Reservation holds and edits

Reservation submission creates a temporary hold before payment. Repeating the same immediate submission is idempotent and must not create duplicate holds.

Returning from the order summary to edit a reservation replaces the previous unpaid hold rather than mutating or transferring it. Availability may show the capacity that will be freed by that customer's replaceable hold, but final submission must cancel the old hold and perform the ordinary full availability check before creating the replacement.

An existing reservation with a pending or completed payment is never silently cancelled or reused by a new form submission. The new submission starts a separate checkout journey.

Every unpaid hold has its own expiry. Expired or abandoned holds are cancelled, with periodic recovery for work that was delayed or failed. A cancellation problem remains visible for operator recovery and must not be presented as a completed cancellation.

Nexi does not publish an expiry guarantee for the current card payment page. Once Nexi has accepted a payment-page order, Workspace therefore keeps the reservation held for a 30-minute local abandonment window. At the end of that window, Workspace may expire and cancel the reservation only after a fresh Nexi lookup reports no operations and no authorized or captured amount. Any provider operation keeps the reservation held for payment reconciliation or operator attention.

Meeting-room checkout remains eligible after its start time while its exclusive end has not passed. A customer may not begin a new payment after the reserved period has ended.

## Payment and fulfillment

A positive payable amount uses the external payment flow. A total of exactly zero completes internally without contacting the payment provider. Both paths preserve the same accepted-price, discount-evidence, reservation, and fulfillment guarantees.

Payment notifications are triggers, not sole proof. Workspace confirms the current payment facts before changing a reservation to paid. A duplicate notification must not repeat payment, redemption, confirmation, or delivery work.

A payment that settles after Workspace has expired its local attempt starts durable recovery. Workspace reuses the original hold only after verifying it remains active at the provider; otherwise it recreates the exact accepted reservation only when the interval has not ended, no newer checkout reservation exists, and current capacity is available. Successful recovery atomically re-redeems any released discount-code claim and continues normal paid fulfillment. An unavailable, superseded, or unreconstructable reservation requires a refund, while an ambiguous provider state requires operator review.

After payment succeeds, Workspace confirms the reservation and delivers the required customer access information. A paid reservation remains paid if fulfillment is delayed or fails; the outstanding work is retried or surfaced for operator recovery. In production, required customer delivery is complete only after delivery is confirmed.

## Customer choices and legal evidence

The reservation page always explains the privacy policy. Privacy-policy acknowledgement is not treated as marketing consent.

Marketing consent is optional and belongs to the customer rather than one reservation. Checking the option grants consent; leaving it unchecked does not withdraw an earlier grant. A withdrawal is a separate deliberate action.

The exact terms and operating rules accepted for payment are preserved as immutable evidence without storing rendered document copies or customer contact details alongside that evidence.

## Privacy and accounting

Workspace stores only the identifiers, states, amounts, timestamps, and immutable evidence needed to operate and recover checkout. Customer contact details, free-form notes, payment-instrument data, raw provider payloads, and access codes are excluded from ordinary local checkout records.

Accounting evidence is the narrow exception: the accepted transaction and buyer facts may be retained in a protected, immutable snapshot for invoice eligibility. Those facts remain unavailable to unrelated product, analytics, logging, and support surfaces.

## Operator expectations

Operators must be able to distinguish a held, paid, fulfilled, expired, cancelling, cancelled, and recovery-needed reservation in business language. A live external cancellation may be shown as an attention state when Workspace is stale, but that observation does not itself rewrite history, authorize access, or prove that Workspace completed recovery.
