# Workspace accounting documents

## Purpose

Workspace preserves the transaction facts needed to issue a trustworthy invoice without rebuilding historical prices, supplier identity, buyer identity, or reservation details from mutable current data.

## Current scope

Each payment attempt receives one protected, immutable source snapshot at the same business boundary as the attempt. The snapshot exists whether or not the customer has requested an invoice, and its presence does not mean that an invoice was requested or issued.

An unsuccessful internal payment no longer needs accounting evidence and may discard its snapshot. A terminal Nexi attempt retains its immutable snapshot because a verified late settlement may need the accepted reservation and price facts for recovery. A paid snapshot is retained and cannot be rewritten. Historical payments are not reconstructed from current customer or catalog data.

The reservation experience records personal or business purpose and collects complete billing details whenever an invoice is required or requested. The encrypted source snapshot freezes that instruction, while the separate issued record remains the only proof that an invoice exists.

## Invoice requirements

An issued invoice is a separate immutable business record. It owns a unique invoice number, issue time, successful payment, completed access-code delivery, customer, reservation, and the exact document facts used for rendering.

- A successful reservation payment may have at most one invoice.
- An invoice may be issued only after the customer access code has been delivered. Its fulfilment date is the date of that recorded delivery, not the date for which the workspace was reserved.
- Repeated or concurrent issuance returns the same invoice rather than consuming another number.
- Invoice numbers use the annual `WS-FV-YYYY-NNNNNN` sequence in Prague time. Committed numbers are never reused and failed issuance does not consume a number.
- Rendering the same issued record always produces the same document even after customer, catalog, or reservation data changes.
- A rendered file is a presentation of the immutable record, not the record itself.

## Reservation purpose and invoice request

Every new reservation is explicitly made for either personal or business use. This purpose belongs to the reservation, not the mutable customer profile, and remains fixed so consumer and business transactions can be distinguished later. Historical reservations whose purpose was not collected remain unknown rather than being inferred.

A business reservation always requires an invoice and a complete business billing identity: legal name, company ID, address line 1, city, postal code, and country. Address line 2 and VAT ID are optional.

A personal reservation may optionally request an invoice. When requested, it requires the person's legal name, address line 1, city, postal code, and country; address line 2 is optional. Without a request, no invoice is issued and no billing fields are retained.

Switching purpose or disabling a personal invoice request removes billing values that are no longer applicable from the submission. Billing details do not affect price, but a change to the purpose, invoice request, or billing identity must not reuse checkout state or an accounting snapshot created for different values.

After payment and access-code fulfilment, the frozen billing identity may update the customer's current operational profile. An abandoned checkout never updates it, and earlier issued invoices remain unchanged.

## Delivery and later requests

The access-code email establishes fulfilment, so an invoice cannot be issued early enough to accompany that same message. After access delivery is confirmed, the issued invoice is sent in a dedicated follow-up to the reservation email address and as a matching internal copy. Delivery failure retains the same invoice and number and retries that document rather than issuing another one. Customer and internal deliveries may recover independently.

A post-order invoice request is available only for an eligible paid reservation with trustworthy source evidence, a verified right to manage that reservation, and no existing invoice. Knowing a public order reference alone is not authorization. The recipient is fixed to the verified reservation contact and is not editable during the request.

Historical reservations without trustworthy transaction facts or a verified recipient use a support fallback rather than reconstructing an invoice from current data.

## Administration and privacy

Authorized operators may view invoices by reservation or customer and generate their presentation on demand. Missing historical protection keys or unreadable versions are explicit unavailable states, not permission to substitute current facts.

Plaintext billing data and rendered invoices must not appear in general reservation records, logs, traces, analytics, caches, or unrelated client payloads. Protection material is retained for as long as any corresponding accounting record must remain readable.
