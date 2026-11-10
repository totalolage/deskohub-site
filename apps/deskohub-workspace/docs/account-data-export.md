# Account data export

## Purpose

The account data export lets a signed-in customer download a machine-readable
ZIP archive of the personal data the Workspace holds about them in its own
records, attributed to the verified account and its linked booking-system
customer. The download is a self-service convenience. It is **not** a
fulfillment of a statutory access request under Article 15 GDPR or a
data-portability request under Article 20 GDPR, it is **not** a claim of full
GDPR compliance or completeness, and it does not replace those requests.

## Where customers find it

The download sits on the account's Legal & Privacy page, below the consent
preferences. The page explains what the archive contains, lists its sections
in a disclosure, and explains what it leaves out, in every customer language.
Only a signed-in customer who can download the archive (see Delivery and
retention) sees it; the page never offers a download it would refuse.

## Scope

Every archive contains a manifest and exactly the nine data sections below.
Nothing else is included.

1. **Identity**: the account identifier, the verified login email, the stored
   display name, account timestamps, and the deletion-request status.
2. **Booking profile**: the customer profile held by the booking-system
   provider (Dotypos): names, phone number, and billing details. When no
   profile exists, the section says so explicitly.
3. **Reservation history**: the reservation summaries from the booking
   system, current and past: product, times, seats, and status.
4. **Workspace reservations**: the Workspace's own records behind the
   customer's bookings: product purpose, reservation, payment, and fulfillment
   state, and lifecycle timestamps.
5. **Payments**: payment attempts for the customer's own reservations:
   provider kind, status, refund state, amount, timestamps, and any
   late-payment recovery outcome.
6. **Discount applications**: discounts applied to the customer's payments:
   label, the amounts before and after, and when each was applied.
7. **Invoices**: metadata of invoices issued to the customer and the delivery
   status of each customer invoice email. The invoice documents themselves are
   **not** included.
8. **Consents**: the customer's marketing communication consent record and the
   legal-acceptance evidence recorded for the customer's own reservations,
   with the document version each acceptance was given under.
9. **Access grants**: door-access grants for the customer's own reservations:
   grant state and the access interval. No access codes, PINs, or credentials.

The manifest describes every section and carries the archive's schema version
and the notes described under "Honesty rules".

## Explicit exclusions

The archive deliberately excludes the following. Customers can request them
through the full data-protection request described below.

- **Credentials and secrets**: session and sign-in tokens, payment security
  tokens and payment-page links, access codes and PINs, and provider
  credentials. Session records are not exported at all.
- **Invoice documents**: the invoice PDFs are not included; only their
  metadata is.
- **Other customers' and third-party records**: every section covers only
  records attributed to the customer through the verified account link. A
  record that cannot be attributed that way is never exported.
- **Unlinked records**: guest records and other records not linked to the
  customer's account.
- **Processor-held data**: analytics events, technical and abuse-prevention
  logs, email delivery logs held by the email provider, and booking-system
  data beyond the profile and reservation history.
- **Internal workflow detail**: internal checkout and provider identifiers,
  internal failure codes, and internal emails.

## Honesty rules

- The archive states that it was assembled from different systems during one
  request, so data that changed meanwhile may appear in only some sections.
- The archive states that it is not a complete copy of every record Deskohub
  holds, and that the excluded categories remain available through a full
  data-protection request.
- Neither the product copy nor this document claims that the download is
  complete or fulfills a statutory request on its own. Whether the
  self-service download meets Articles 15 and 20 GDPR together with the manual
  request path remains under legal and operational review.

## Delivery and retention

- The archive is generated fresh for every download and delivered only as a
  download to the signed-in customer. It is not emailed, not stored, and has
  no shareable link.
- The download is available only while the customer's verified account is
  linked to its customer record and not being deleted. After deletion,
  remaining records can be requested only through the full request.
- When any part of the archive can't be produced, the customer gets no file
  at all, never a partial one, and can try again or make a full request.

## Full statutory requests

This export does not include all retained personal data and does not create a
format-migration guarantee. Full access and portability requests remain
available through the privacy contact published on the website's privacy
policy page, which also describes the processing purposes, retention periods,
recipients, and rights that apply to those requests.
