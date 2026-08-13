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

Meeting-room checkout remains eligible after its start time while its exclusive end has not passed. A customer may not begin a new payment after the reserved period has ended.

## Payment and fulfillment

A positive payable amount uses the external payment flow. A total of exactly zero completes internally without contacting the payment provider. Both paths preserve the same accepted-price, discount-evidence, reservation, and fulfillment guarantees.

Payment notifications are triggers, not sole proof. Workspace confirms the current payment facts before changing a reservation to paid. A duplicate notification must not repeat payment, redemption, confirmation, or delivery work.

After payment succeeds, Workspace confirms the reservation and sends a customer confirmation containing a protected link to the dedicated reservation access page. The email never contains the door PIN. A paid reservation remains paid if confirmation is delayed or fails; the outstanding work is retried or surfaced for operator recovery. In production, required customer delivery is complete only after delivery is confirmed.

The protected access page resolves the current PIN on each authorized request. It discloses the PIN only for a paid reservation that is confirmed both locally and by the reservation provider, during the half-open interval from 30 minutes before the reserved start until 30 minutes after the reserved end. The display grace period does not extend the customer's right to use the space or the PIN's validity.

On the first eligible access-page request, Workspace creates and durably records a time-limited front-door algoPIN for the reservation period; later requests reuse it. The Retrofit Lock (OE1) uses its linked Keypad (EK1) as the algoPIN target, so customers need only the numeric code and do not need the Igloohome app. A code lasting more than 24 hours must be used during its first 24 hours of validity to activate it. If Igloohome may have created a code but Workspace cannot prove the result, the access page withholds a code for operator recovery and must not automatically create another credential. Payment redirects and fulfillment recovery remain on the separate reservation status page.

## Customer choices and legal evidence

The reservation page always explains the privacy policy. Privacy-policy acknowledgement is not treated as marketing consent.

Marketing consent is optional and belongs to the customer rather than one reservation. Checking the option grants consent; leaving it unchecked does not withdraw an earlier grant. A withdrawal is a separate deliberate action.

Payment uses one affirmative checkout choice to accept the current terms and operating rules. When the service begins inside the statutory withdrawal period, that same visible choice also includes the customer's express request to begin at the reserved time and acknowledgement that the withdrawal right ends after full performance. The terms explain that a proportionate amount may be due after partial performance.

The paths and hashes of the terms and operating rules accepted for payment are preserved as immutable evidence without storing rendered legal-document copies or customer contact details alongside that evidence. When applicable, one early-performance consent fact records the combined request and acknowledgement behind the single checkout choice, without adding a new database document store.

Every new reservation declares personal or business purpose. A business reservation always includes an invoice; a personal reservation includes one only when requested. Purpose remains fixed with the reservation so later customer-profile changes cannot reclassify the transaction.

## Privacy and accounting

Workspace stores only the identifiers, states, amounts, timestamps, and immutable evidence needed to operate and recover checkout. Customer contact details, free-form notes, payment-instrument data, raw provider payloads, and access codes are excluded from ordinary local checkout records.

The narrow access exception stores an issued, time-bound algoPIN in a dedicated credential ledger so repeated access-page requests reuse the same code without creating another one. The daily cleanup removes expired PIN values. A reservation timing change after issuance withholds the old PIN for operator reconciliation. Codes remain excluded from email, logs, analytics, ordinary reservation records, and operator-facing payloads.

Accounting evidence is the narrow exception: the accepted transaction and buyer facts may be retained in a protected, immutable snapshot for invoice eligibility. Those facts remain unavailable to unrelated product, analytics, logging, and support surfaces.

## Operator expectations

Operators must be able to distinguish a held, paid, fulfilled, expired, cancelling, cancelled, and recovery-needed reservation in business language. A live external cancellation may be shown as an attention state when Workspace is stale, but that observation does not itself rewrite history, authorize access, or prove that Workspace completed recovery.

An authorized operator may explicitly cancel a held or confirmed reservation when fulfillment is not actively processing. This cancellation preserves payment and fulfillment history and does not issue a refund. The operator may separately request a localized cancellation email; email delivery occurs after cancellation and cannot roll it back.
