# Workspace checkout lifecycle

## Purpose

Checkout turns a customer's selected Workspace product into a temporary reservation, an accepted price, a completed payment when money is due, and a fulfilled reservation. The lifecycle must remain understandable and recoverable when a customer navigates back, retries, abandons payment, or an external service is temporarily unavailable.

## Ownership

- The reservation system owns current customer and booking facts.
- The payment provider owns external payment processing facts.
- Workspace owns the customer's checkout journey, accepted price, local payment and fulfillment status, legal evidence, and recovery decisions.
- Workspace must not become a duplicate customer profile, reservation store, payment-instrument archive, or raw provider-event archive.

## Accounts and reservation steps

Every reservation is made by a signed-in customer account with a verified email. There is no guest checkout. The account that submits a reservation is its author. The reservation's customer is the person it is for: the account's own customer, or someone else the account books for.

A reservation page has two steps before payment:

1. **Choose your space.** Product, date and time, seats, and add-ons.
2. **Contact details.** A summary of the selection with a way back to change it, who the reservation is for, business use and invoice options, the privacy notice, and marketing consent.

Payment follows. Access information shows after booking and is not a checkout step.

What the contact step asks depends on the visitor:

- **Signed out.** The visitor enters name, email, and phone, plus billing options. Continuing sends a verification email to that address and asks the visitor to verify it. The email carries a sign-in link, and a 6-digit code as well when sign-in codes are enabled. "Already a customer? Sign in" opens sign-in instead. The typed details travel sealed with the sign-in and come back with it for 30 minutes. Verifying signs the visitor in, saves their profile, which creates or links their customer record with any typed business and invoice billing, and continues to payment.
- **Verified email that already has a profile.** The saved profile wins over the typed details. The page books as that profile, says so, and offers the typed details without the email for booking someone else.
- **Signed in without a profile.** The same form, with the email fixed to the account's email. Name and phone are required. Continuing creates the profile, with billing, and continues to payment.
- **Signed in with a profile.** The page books as the account's own customer ("Booking as"). "Book for someone else" asks for that person's name, email, the email again (the two must match), and phone.
- **Account unavailable.** If the account can't be read, the step shows an error and a retry instead of a form.

## Price acceptance

Checkout has three customer commitments:

1. The reservation page advertises a price for the selected product.
2. Reservation submission produces the authoritative order summary the customer reviews.
3. Order submission freshly confirms that the accepted summary is still payable before payment starts.

The advertised price includes only adjustments that can be discovered without identifying the customer. Customer-specific pricing may first appear on the order summary after the customer has been identified. Once any discount has appeared on the summary, it becomes part of the accepted price and must be freshly confirmed like every other adjustment.

A newly available automatic discount is not added retrospectively to an existing checkout. A discount that disappears or changes produces an updated summary and asks the customer to accept the price again. No payment begins until the payable amount exactly matches the last summary the customer reviewed.

A discount counts as gone only when the service that offers it answers in full and no longer includes it. When that service is temporarily unavailable or answers only partly, Workspace can neither confirm nor remove a discount the customer has already seen. It never applies such a discount unconfirmed, and it never silently drops it from the price. The customer keeps the price they were shown and is asked to try again; checkout does not change the summary or start a payment until the discount can be confirmed or is confirmed gone.

Zero-priced components may appear in the order summary without changing the price. They remain part of the reserved product even though they do not affect the advertised amount.

## Discount codes

An ordinary code in a reservation URL's `discountCode` query parameter is provisionally included in the advertised price. The anonymous preview excludes vouchers and cannot establish customer-specific eligibility. Reservation submission performs the complete validation after identifying the customer. A code that fails this validation remains in the code input on the payment page for ordinary retry or correction and is never represented as applied; checkout presents the updated summary without it for acceptance.

Entering a discount code on the order summary remains an independent action:

- An invalid or unavailable code is shown as a field error and leaves the existing summary payable.
- An accepted code produces a new summary for review; it does not start payment or consume the code yet.
- Capacity is reserved only when the customer proceeds with the accepted summary.
- A successful payment permanently redeems the claim. A failed, cancelled, or expired payment releases it.
- If the code or another displayed discount can no longer be honored, checkout returns an updated summary before any payment session is created.
- If a displayed discount cannot be confirmed right now, the code is not applied and the existing summary stays payable.

Voucher codes follow the same customer flow but resolve to their current stored credit rather than a discount definition. Code entry only quotes that credit. Final payment admission locks and reserves the exact applied amount; terminal failure releases it, and successful payment consumes it permanently.

## Reservation links

The meeting-room reservation page accepts prefill parameters in its URL in every supported locale:

- `name`, `email`, and `phone` prefill the contact step. For a signed-in customer with a saved profile, they prefill booking for someone else.
- `startDateTime` is a local start in `YYYY-MM-DDTHH:mm` form, interpreted in the Workspace timezone (Europe/Prague). Only whole hours are accepted.
- `duration` accepts `hour:1`, `hour:4`, or `day:1`.
- `discountCode` carries an ordinary discount code.

Browsers percent-encode query values, so a leading `+` in a phone number must be sent as `%2B`; a literal `+` decodes as a space.

Each field is decoded on its own. An empty, malformed, or daylight-saving-invalid start, a start whose interval has already ended, or an unsupported duration falls back to the fresh default for that field alone; valid sibling parameters still apply. When no start is given, the page chooses the earliest whole-hour start for the chosen duration, which may be an interval that has already begun. A linked start that has already begun stays selected while its interval has not ended. This choice is not an availability guarantee; only submission checks availability.

A signed checkout-restoration link takes precedence over the public contact and `discountCode` parameters. Selection parameters beside it are the customer's own edits after returning from the order summary (the order summary links back with the restoration alone), so they replace the restored selection; the restored checkout, its hold replacement, contact details, and discount still apply. When the restored checkout has ended, the page uses its fresh defaults and does not carry the public parameters forward. A reservation link never opts the customer into marketing consent or legal acceptance.

Example with synthetic, deliberately non-working values (`example.invalid`, `EXAMPLE_CODE`):

```
/{locale}/reservation/meeting-room?name=Example&email=customer%40example.invalid&phone=%2B420123456789&startDateTime=2099-08-12T10%3A00&duration=hour%3A1&discountCode=EXAMPLE_CODE
```

The office reservation page accepts these parameters:

- `startsOn` is the first reserved day in `YYYY-MM-DD` form, in the Workspace timezone. It must fall inside the office booking window, from today through the last bookable day one month ahead. A malformed date, or one outside the window, opens the page on today.
- `dayCount` is the number of whole days. A count that doesn't fit the booking window from the start date falls back to the default.
- `seats` is the number of seats. A count above the office capacity falls back to the default.
- `discountCode` carries an ordinary discount code.

The page shows the price and availability for the linked start date. A linked date that is fully booked stays selected and is marked unavailable, so the customer can pick another day. Office links never prefill contact details.

```
/{locale}/reservation/office?startsOn=2099-08-12&dayCount=3&seats=2&discountCode=EXAMPLE_CODE
```

### The page keeps the selection in its URL

As the customer changes a selection, each reservation page writes it back to its URL with the same parameters a link uses:

- cowork: `entryTier`, `date`, `coffee`, `monitorOption` (`none` when the customer turns an optional workstation off, so the customer's last reservation doesn't turn it back on)
- meeting room: `startDateTime`, `duration`
- office: `startsOn`, `dayCount`, `seats` (the day count only once it's a valid count)

Reloading the page, or opening a copy of its URL, restores the same selection, including after returning from the order summary to edit it. The update replaces the current browser history entry, so Back still leaves the page in one step. The page never writes `name`, `email`, `phone`, or `customer` to the URL, so contact details don't reach browser history or analytics; these parameters in an incoming link are still read and left as they arrived. Every other parameter, such as `discountCode`, also stays as it arrived.

The contact step adds `step=contact` to the URL, so a reload stays on it; without it the page opens on choosing the space. Details typed by a signed-out visitor come back from sign-in in one sealed `contact` parameter that only this checkout can read and that expires after 30 minutes.

## Reservation holds and edits

Reservation submission creates a temporary hold before payment. Repeating the same immediate submission is idempotent and must not create duplicate holds.

The confirmation and access link go only to the reservation email, so submission rejects an email typed for someone else whose domain provably cannot receive mail (it does not exist, declares that it accepts no mail, or publishes neither a mail server nor an address) before any customer, hold, or payment is created, and asks the customer to correct it. A lookup that cannot reach a definite answer does not block the booking. The account's own email is verified at sign-in and is not rechecked.

Returning from the order summary to edit a reservation replaces the previous unpaid hold rather than mutating or transferring it. Availability may show the capacity that will be freed by that customer's replaceable hold, but final submission must cancel the old hold and perform the ordinary full availability check before creating the replacement.

An existing reservation with a pending or completed payment is never silently cancelled or reused by a new form submission. The new submission starts a separate checkout journey.

Every unpaid hold has its own expiry. Expired or abandoned holds are cancelled, with periodic recovery for work that was delayed or failed. A cancellation problem remains visible for operator recovery and must not be presented as a completed cancellation.

Nexi does not publish an expiry guarantee for the current card payment page. Once Nexi has accepted a payment-page order, Workspace therefore keeps the reservation held for a 30-minute local abandonment window. At the end of that window, Workspace may expire and cancel the reservation only after a fresh Nexi lookup reports no operations and no authorized or captured amount. Any provider operation keeps the reservation held for payment reconciliation or operator attention.

Meeting-room checkout remains eligible after its start time while its exclusive end has not passed. A customer may not begin a new payment after the reserved period has ended.

After fulfillment, "Book again" may carry only the reusable product shape into a fresh reservation. It never carries the old date or time, customer or invoice details, accepted price, discount, payment state, provider identifiers, or access data. If Workspace cannot recover a trustworthy product shape, the action starts a generic new reservation for that family.

After a payment fails, is cancelled, or expires, "Try again" reopens the same family's reservation page with the original selection, including its date or time, so the customer can pay in a fresh checkout. The link carries no customer or invoice details, accepted price, discount, payment state, provider identifiers, or access data, and the reservation page checks availability and price again. If Workspace cannot recover the selection, the action opens that family's reservation page without one.

## Payment and fulfillment

A positive payable amount uses the external payment flow. Before payment, the page states the amount on its pay action and explains that payment finishes on the provider's secure page in a new tab, that the customer's bank may ask for confirmation in its app, and that the original tab then shows the reservation status. A total of exactly zero completes internally without contacting the payment provider. Both paths preserve the same accepted-price, discount-evidence, reservation, and fulfillment guarantees.

Payment notifications are triggers, not sole proof. Workspace confirms the current payment facts before changing a reservation to paid. A duplicate notification must not repeat payment, redemption, confirmation, or delivery work.

A payment that settles after Workspace has expired its local attempt starts durable recovery, whether Workspace learns of it from the Nexi notification or from the customer's status page. Workspace keeps the original hold only while its reservation deadline has not passed. After that deadline the slot may already have been offered to other customers, so Workspace releases the original hold and books the exact accepted reservation and price again through the normal availability check and table assignment, as long as the interval has not ended and no newer checkout reservation exists. Successful recovery atomically re-redeems any released discount-code claim and continues normal paid fulfillment, and the customer sees the ordinary confirmed status. If no capacity or table remains, or the reservation is superseded or cannot be reconstructed, Workspace atomically marks the paid Nexi attempt as requiring a refund, using the same refund-work state as operator cancellation. The status page then tells the customer that the payment arrived after the reservation was no longer available and will be refunded. While recovery is still running, the page says the reservation is being checked. An ambiguous provider state requires operator review; the page says the reservation must be checked manually and asks the customer to contact Deskohub through a prefilled support request. An explicit operator force-cancellation is never recovered into a booking: any later provider settlement requires a refund.

After payment succeeds, Workspace confirms the reservation and sends a customer confirmation containing a protected link to the dedicated reservation access page. The email never contains the door PIN. When an account booked the reservation for someone else, Workspace also sends that account its own confirmation naming who the booking is for, with the reservation details and a link to the reservation's status page. It carries no access link, invoice link, or PIN; the account's sign-in authorizes the status page. This confirmation is secondary: it never delays, fails, or changes the customer's confirmation or the reservation's fulfillment, and fulfillment retries do not repeat it. A deleted account, a reservation made before authors were recorded, and a customer's own booking get no separate confirmation. A paid reservation remains paid if confirmation is delayed or fails; the outstanding work is retried or surfaced for operator recovery.

In production, required customer delivery is complete only after delivery is confirmed. When the email provider accepts the customer send, Workspace records that send's active non-personal delivery identifier and waits for the provider's verdict instead of completing fulfillment. A delivery verdict applies only when its identifier matches the recorded one and the provider's event time is strictly newer than the outcome already recorded; older or equally timed verdicts change nothing. A strictly newer confirmation completes the waiting reservation or repairs a reservation whose only failure was that email delivery. A strictly newer delivery failure or bounce fails the waiting reservation and may reverse an already completed fulfillment to failed, so a confirmation known to be undelivered is treated as such and surfaces for recovery. Recovery of stale in-progress fulfillment never reclaims a waiting reservation. When a delivery fails or bounces, the fulfillment retry orders a fresh provider send the provider cannot collapse into the failed one; repeating that same recovery reuses one send identity until a send is accepted, and each accepted send starts a new generation for any later failure. Outside production, fulfillment completes when the provider accepts the customer send.

The status page offers a new reservation only when the checkout holds no live paid reservation and no payment that could still settle, or as "Book again" after fulfillment. While a provider payment is still processing, the page says no new booking is needed and asks the customer to finish the payment in the provider's tab if it is still open; if it is still unconfirmed at the 30-minute provider abandonment cutoff, the page asks the customer not to book again until Deskohub confirms the payment or responds, and offers a prefilled support request instead of a new checkout, because releasing the local hold does not stop the provider payment from settling later. While a paid reservation lacks a delivered confirmation, the page says the payment went through and that no new booking is needed, and it calls the reservation confirmed only after Dotypos confirms it. A confirmed reservation awaiting its delivery verdict shows the address the confirmation went to. If fulfillment or delivery is still unfinished ten minutes after payment, the page stops promising automatic completion and offers the prefilled support request used for a failed delivery. A failed or bounced delivery shows the address, when known, and makes that support request the primary action. The door PIN stays on the protected access page.

The status page authorizes a reservation's author signed in to their account, a signed-in account whose own customer the reservation is for, and the holder of the customer's emailed protected link. Submitting a reservation grants the browser no access of its own; the author's sign-in covers it. The protected access page, which shows the door PIN, authorizes the same visitors except the author: an author who booked for someone else sees the status but not the PIN. A signed-out visitor opening a status link is asked to sign in to see the reservation and returns to the status page afterwards. Anyone else not authorized sees the reservation as not found.

The protected access page resolves the current PIN on each authorized request for a paid reservation that is confirmed both locally and by the reservation provider. It shows the exact start and end times programmed into the PIN but does not impose a separate display window. Those programmed AlgoPIN bounds are the sole authority for when the lock accepts it.

Paid fulfillment creates and durably records a time-limited front-door AlgoPIN for the reservation period; later access-page requests reuse it. The Retrofit Lock (OE1) uses its linked Keypad (EK1) as the AlgoPIN target, so customers need only the numeric code and do not need the Igloohome app. A code lasting more than 24 hours must be used during its first 24 hours of validity to activate it. If Igloohome may have created a code but Workspace cannot prove the result, the access page withholds a code and must not automatically create another credential. An operator may retry only after using the Igloohome app over Bluetooth at the lock to remove the named credential or verify that it is absent, then explicitly confirming that cleanup. Payment redirects and fulfillment recovery remain on the separate reservation status page.

## Customer choices and legal evidence

The reservation page always explains the privacy policy. Privacy-policy acknowledgement is not treated as marketing consent.

Marketing consent is optional and belongs to the customer rather than one reservation. Checking the option grants consent; leaving it unchecked does not withdraw an earlier grant. A withdrawal is a separate deliberate action. A customer booking for themselves who already consents is not shown the option again. Booking for someone else never asks, because consent belongs to the account's own customer and the booker can't grant it for another person.

Payment uses one affirmative checkout choice to accept the current terms and operating rules. When the service begins inside the statutory withdrawal period, that same visible choice also includes the customer's express request to begin at the reserved time and acknowledgement that the withdrawal right ends after full performance. The terms explain that a proportionate amount may be due after partial performance.

The paths and hashes of the terms and operating rules accepted for payment are preserved as immutable evidence without storing rendered legal-document copies or customer contact details alongside that evidence. When applicable, one early-performance consent fact records the combined request and acknowledgement behind the single checkout choice, without adding a new database document store. Each accepted document's evidence states which acknowledgements came with it, including none. Evidence recorded before acknowledgements were preserved leaves them unknown; Workspace never infers or backfills a consent that was not recorded.

Every new reservation declares personal or business purpose. A business reservation always includes an invoice; a personal reservation includes one only when requested. Purpose remains fixed with the reservation so later customer-profile changes cannot reclassify the transaction.

A personal customer who did not request an invoice during checkout may create one later from the protected invoice link in the reservation email. The link carries the same reservation-scoped cryptographic capability used for access-code disclosure; the order ID alone never authorizes invoice lookup or creation. The page collects a fresh billing address, delivers the immutable invoice only to the reservation email captured at payment time, and allows an existing invoice to be resent to that address without exposing it.

## Account reservation history

A signed-in customer's reservation history lists the reservations of their own customer record and the reservations they booked for other customers. A reservation booked for someone else is labelled with that customer's name. A reservation another account booked for them is labelled with that account holder's name, or as booked by a deleted account once that account is deleted. A name that cannot be read is replaced with a neutral label and never hides the reservation or the rest of the history.

## Privacy and accounting

Workspace stores only the identifiers, states, amounts, timestamps, and immutable evidence needed to operate and recover checkout. Customer contact details, free-form notes, payment-instrument data, raw provider payloads, and access codes are excluded from ordinary local checkout records.

The narrow access exception stores an issued, time-bound AlgoPIN in a dedicated credential ledger so repeated access-page requests reuse the same code without creating another one. Workspace retains the PIN and does not use its own clock to expire or hide it; Igloohome enforces its programmed validity at the lock. If a reservation move changes the rounded interval programmed into the PIN, the next authorized access request transparently issues and displays a replacement for the new interval. Secret codes remain excluded from email, logs, analytics, ordinary reservation records, and operator-facing payloads; safe grant state, interval, device, provider identifier, and failure metadata may be shown to operators.

Accounting evidence is the narrow exception: the accepted transaction and buyer facts may be retained in a protected, immutable snapshot for invoice eligibility. Those facts remain unavailable to unrelated product, analytics, logging, and support surfaces.

## Operator expectations

Operators must be able to distinguish a held, paid, fulfilled, expired, cancelling, cancelled, refund-required, and recovery-needed reservation in business language. A live external cancellation may be shown as an attention state when Workspace is stale, but that observation does not itself rewrite history, authorize access, or prove that Workspace completed recovery.

An authorized operator may explicitly cancel a held or confirmed reservation only while fulfillment is quiet: both an active confirmation run and a still-unresolved confirmation-email delivery block cancellation until they complete, because a pending email verdict can still change the booking's fulfillment outcome. This cancellation preserves payment and fulfillment history, atomically marks any paid Nexi attempt as requiring a refund, and does not issue the refund automatically. Operators refund in the Nexi back office. Once Nexi reports any successful refund of the payment, full or partial, Workspace records the refunded amount and time and the payment no longer needs a refund. Workspace also records a back-office refund, including the rest of a partial refund, of a payment made within the last 30 days that nobody cancelled in Workspace, usually within a day. An older payment refunded only in the back office is recorded once Workspace marks it as needing a refund, for example through an operator cancellation. Zero-total internal payments remain refund-free. The operator may separately request a localized cancellation email; email delivery occurs after cancellation and cannot roll it back.
