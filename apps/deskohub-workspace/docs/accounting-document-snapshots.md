# Workspace accounting documents

## Purpose

Workspace preserves the transaction facts needed to issue a trustworthy invoice without rebuilding historical prices, supplier identity, buyer identity, or reservation details from mutable current data.

## Current scope

Each payment attempt receives one protected, immutable source snapshot at the same business boundary as the attempt. The snapshot exists whether or not the customer has requested an invoice, and its presence does not mean that an invoice was requested or issued.

An unsuccessful terminal payment no longer needs accounting evidence and may discard its snapshot. A paid snapshot is retained and cannot be rewritten. Historical payments are not reconstructed from current customer or catalog data.

The current reservation experience does not yet collect a complete reservation-specific business billing identity or issue customer invoices. Until that experience is introduced, a source snapshot must not be presented as an invoice.

## Invoice requirements

An issued invoice is a separate immutable business record. It owns a unique invoice number, issue time, successful payment, customer, reservation, and the exact document facts used for rendering.

- A successful reservation payment may have at most one invoice.
- Repeated or concurrent issuance returns the same invoice rather than consuming another number.
- Invoice numbers use the annual `WS-FV-YYYY-NNNNNN` sequence in Prague time. Committed numbers are never reused and failed issuance does not consume a number.
- Rendering the same issued record always produces the same document even after customer, catalog, or reservation data changes.
- A rendered file is a presentation of the immutable record, not the record itself.

## Customer invoice request

Invoice request is optional and separate from payment consent. When requested during reservation, the customer supplies:

- address line 1, city, postal code, and country;
- optional address line 2; and
- optional company name, company ID, and VAT ID.

Unchecking the option removes the request and hidden billing values from the submission. Billing details do not affect price, but a change to them must not reuse a checkout snapshot created for different details.

The newest explicitly submitted billing identity may update the customer's current operational profile. Earlier issued invoices remain unchanged.

## Delivery and later requests

When an invoice exists, it accompanies the matching customer confirmation and internal reservation notification. Delivery failure retains the same invoice and number and retries that document rather than issuing another one. Customer and internal deliveries may recover independently.

A post-order invoice request is available only for an eligible paid reservation with trustworthy source evidence, a verified right to manage that reservation, and no existing invoice. Knowing a public order reference alone is not authorization. The recipient is fixed to the verified reservation contact and is not editable during the request.

Historical reservations without trustworthy transaction facts or a verified recipient use a support fallback rather than reconstructing an invoice from current data.

## Administration and privacy

Authorized operators may view invoices by reservation or customer and generate their presentation on demand. Missing historical protection keys or unreadable versions are explicit unavailable states, not permission to substitute current facts.

Plaintext billing data and rendered invoices must not appear in general reservation records, logs, traces, analytics, caches, or unrelated client payloads. Protection material is retained for as long as any corresponding accounting record must remain readable.
