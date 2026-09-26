# Account data export

## Purpose

The account data export lets a signed-in customer download a machine-readable copy of the personal data the Workspace account holds about them. The download is a self-service convenience. It is **not** a fulfillment of a statutory access request under Article 15 GDPR or a data-portability request under Article 20 GDPR, and it does not replace those requests.

## Scope

Every export contains exactly the four data sections below and a metadata section. Nothing else is included.

1. **Identity** — the account identifier, the verified login email with its verification status, the stored display name when one exists, account creation and update timestamps when available, and the deletion-request status.
2. **Profile** — the customer profile held by the booking-system provider (Dotypos): first name, last name, phone number, and billing details. When no profile exists, the section is an explicit null.
3. **Reservations** — the reservation summaries already shown in the account's reservation history: identifiers, product, start and end times, seat count, and status.
4. **Marketing consent** — the customer-level marketing communication consent: grant and withdrawal timestamps and the consent locale. When no consent record exists, the section is an explicit null.

The export never contains invoice PDFs, provider email delivery logs, analytics or technical logs, unlinked guest or contact-form submissions, payment credentials, session identifiers, tokens, PIN codes, secrets, other customers' records, or any other retained commercial record.

## Format and assembly

- The export is a UTF-8 JSON document with a versioned schema (`schemaVersion`).
- The snapshot is generated fresh for every download request. It is not a stored archive.
- The snapshot is assembled during the request from several systems (account authentication, the booking-system provider, and the consent store). It is therefore **not** an atomic cross-provider transaction: data that changes while the snapshot is being assembled may be captured in only one section.
- The metadata section carries a fixed human-readable note stating exactly that: the snapshot is assembled during the request from different systems, is not an atomic cross-system transaction, and concurrent changes may appear in only some sections.
- Sections describe themselves, and a section with no records says so explicitly instead of being omitted.

## Delivery and retention

- The export is delivered only as an authenticated browser download (a JSON file attachment) over HTTPS. There is no email delivery, no signed URL, no persistent archive, export job, or queue, no database copy, no server-side file retention, and no publicly reachable URL.
- During a request the snapshot exists only in the server's memory while the response is being produced; afterwards it exists only in the customer's own browser. These are the only retention locations.

## Security controls

- The download route requires a verified session against the authoritative database and the verified one-to-one link between the account and the customer record. A pending account-deletion marker fails the request.
- Authorization always derives from the server-side session. An email address or identifier supplied by the client is never used to authorize an export.
- Every control fails closed: when the feature is disabled or any data source fails, the whole request fails with a generic error and no document — not even a partial one — leaves the server.

## Full statutory requests

Because this export does not include all retained personal data and does not create a format-migration guarantee, full access and portability requests remain available through the privacy contact published on the website's privacy policy page.
