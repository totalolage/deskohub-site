# Account data export

## Purpose

The account data export lets a signed-in customer download a machine-readable
ZIP archive of the personal data the Workspace holds about them in its own
records, attributed to the verified account and its linked booking-system
customer. The download is a self-service convenience. It is **not** a
fulfillment of a statutory access request under Article 15 GDPR or a
data-portability request under Article 20 GDPR, it is **not** a claim of full
GDPR compliance or completeness, and it does not replace those requests.

## Scope

Every archive contains a manifest and exactly the nine data sections below.
Nothing else is included.

1. **Identity** (`identity.json`) — the account identifier, the verified login
   email with its verification status, the stored display name when one
   exists, account creation and update timestamps when available, and the
   deletion-request status.
2. **Booking profile** (`dotypos-profile.json`) — the customer profile held by
   the booking-system provider (Dotypos): first name, last name, phone number,
   and billing details. When no profile exists, the section is an explicit
   null.
3. **Reservation history** (`reservation-history.json`) — the reservation
   summaries already shown in the account's reservation history: identifiers,
   product, start and end times, seat count, and status, including current and
   past reservations.
4. **Workspace reservations** (`workspace-reservations.json`) — the local
   reservation records behind the bookings: product purpose, reservation,
   payment, and fulfillment state, the reservation locale, and lifecycle
   timestamps (created, confirmed, cancelled, paid, fulfilled).
5. **Payments** (`payments.json`) — payment attempts for the customer's own
   reservations: provider kind (card or internal), status, refund state,
   amount, currency, timestamps, and any late-payment recovery outcome (state
   and completion timeline).
6. **Discount applications** (`discount-applications.json`) — discounts
   applied to the customer's payments: label, the amounts before and after,
   and when each application was recorded.
7. **Invoices** (`invoices.json`) — metadata of invoices issued to the
   customer: invoice number, issue date, numbering, the related reservation
   and payment references, whether the accounting document snapshot exists and
   when it was recorded, and the delivery status of the customer-audience
   invoice email. The invoice documents themselves are **not** included.
8. **Consents** (`consents.json`) — the customer-level marketing
   communication consent (grant and withdrawal timestamps and the consent
   locale; an explicit null when no record exists) and the legal-acceptance
   evidence events tied to the customer's own reservations (document key,
   acceptance fact, time, locale, and source).
9. **Access grants** (`access-grants.json`) — door-access grants for the
   customer's own reservations: grant state and the access interval. No
   access codes, PINs, provider credential identifiers, or device identifiers
   are included.

The manifest (`manifest.json`) carries the archive schema version, the
generation time, the ordered section list with a one-sentence description of
each section, and the fixed notes described below.

## Explicit exclusions

The archive deliberately excludes, and routes to the full manual access path:

- **Credentials and secrets** — session tokens, magic-link tokens, payment
  security tokens and redirect URLs, access codes and PINs, provider
  credential identifiers, and encryption key identifiers. No session metadata
  section is exported: session records cannot be projected without drawing on
  security-adjacent material, so they are omitted entirely.
- **Invoice documents** — the encrypted invoice PDFs and accounting-document
  snapshots are not included; only their metadata is.
- **Other customers' and third-party records** — every section is scoped
  through the verified account-to-customer link and the customer-owned keys in
  each record; a record that cannot be attributed through those joins is never
  exported.
- **Unlinked guest records** and records without a customer attribution.
- **Processor-held logs** — analytics events, technical and abuse-prevention
  logs, email delivery logs held by the email provider, and booking-system
  data beyond the current profile and reservation-history integration.
- **Internal workflow detail** — internal checkout session and attempt keys,
  provider order, operation, and webhook identifiers, internal failure codes,
  and internal-audience email deliveries.

## Honesty rules

- The archive carries a fixed note that it was assembled during a single
  request from different systems and is therefore not an atomic cross-system
  transaction: data changed concurrently may appear in only some sections.
- The archive carries a fixed note that it is not a complete copy of every
  record Deskohub holds, and that the excluded categories above remain
  available through a full data-protection request.
- Neither the product copy nor this document claims completeness or full GDPR
  compliance for the download.

## Format, bounds, and assembly

- The archive is a UTF-8 JSON ZIP file. Each section is one JSON file with a
  fixed name; the manifest lists exactly the files an archive may contain.
- The archive schema is versioned (`schemaVersion` in the manifest).
- The archive is generated fresh for every download request. It is not a
  stored archive.
- Assembly is bounded: the number of entries and the uncompressed content
  size are capped. When a bound is exceeded, or any assembly or data error
  occurs, the whole request fails and nothing is delivered — there is no
  silent truncation and no partial download.
- Each customer-scoped local record read behind a section applies a
  documented per-customer upper bound (`accountDataExportRecordBounds` in
  the records repository). The bounds are generous, chosen far above any
  typical data shape for one customer, but a customer with an
  unusually long history can legitimately exceed one. Every query fetches at
  most `bound + 1` rows; the extra sentinel row proves an overflow and fails
  the whole request closed exactly like a size-bound violation: nothing is
  delivered and no record is truncated, and the customer is directed to the
  full manual access request. These bounds are per-customer-scope memory
  guards, never a substitute for the customer-scoping query filters.
- The per-read sentinel bounds apply to local first-party record reads and,
  alongside them, to the entry-count and uncompressed-size caps of the
  serialized ZIP archive. Data sourced from the booking-system provider
  (the customer profile and the provider-side reservation summaries) is
  fetched per the existing upstream contract and is not claimed as bounded
  end-to-end.
- The snapshot is assembled during the request from several systems (account
  authentication, the booking-system provider, the consent store, and the
  local reservation, payment, and accounting records). It is therefore not an
  atomic cross-system transaction.
- Sections describe themselves, and a section with no records is empty or an
  explicit null instead of being omitted.

## Delivery and retention

- The archive is delivered only as an authenticated browser download (a ZIP
  file attachment) over HTTPS, with a response that must not be stored. There
  is no email delivery, no signed URL, no persistent archive, export job, or
  queue, no database copy, no server-side file retention, and no publicly
  reachable URL.
- During a request the archive exists only in the server's memory while the
  response is being produced; afterwards it exists only in the customer's own
  browser. These are the only retention locations.

## Security controls

- The download route requires a verified session against the authoritative
  database and the verified one-to-one link between the account and the
  customer record. A pending account-deletion marker fails the request.
- Deleting the account removes the account-to-customer link. From that moment
  the automatic ownership proof is gone, the download fails closed, and any
  remaining records can be requested only through the full access path.
- Authorization always derives from the server-side session. An email address
  or identifier supplied by the client is never used to authorize an export.
- Every control fails closed: when the feature is disabled, a bound is hit, or
  any data source fails, the whole request fails with a generic error and no
  archive — not even a partial one — leaves the server.

## Full statutory requests

This export does not include all retained personal data and does not create a
format-migration guarantee. Full access and portability requests remain
available through the privacy contact published on the website's privacy
policy page, which also describes the processing purposes, retention periods,
recipients, and rights that apply to those requests.
