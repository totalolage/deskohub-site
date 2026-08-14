# Accounting document snapshots

## Contents

- [Current boundary](#current-boundary)
- [Iterative implementation plan](#iterative-implementation-plan)
- [Key deployment and rotation](#key-deployment-and-rotation)
- [Logging and tracing requirements](#logging-and-tracing-requirements)
- [Preview validation gate](#preview-validation-gate)

Workspace freezes the accepted price, supplier identity, buyer identity, reservation facts, and delivery target alongside each payment attempt. PostgreSQL encrypts the serialized JSON with `pgcrypto`; the database stores only a `bytea` ciphertext plus non-PII lookup metadata. Issued invoices are separately encrypted and rendered dynamically as PDFs. Delivery state is stored separately without recipient or document PII.

Reservation-purpose UI and automatic post-fulfilment issuance are implemented. Post-order requests and administration views remain later stages. Issuance derives transaction facts from the payment snapshot rather than mutable Dotypos customer or product data; rendering reads the immutable issued-document snapshot described below.

## Current boundary

`accounting_document_snapshots` contains one immutable row per payment attempt:

- `payment_attempt_id`
- `workspace_reservation_id`
- `key_id`
- `encrypted_snapshot bytea`
- `created_at`

The encrypted JSON is versionless and decoded strictly. Do not add schema-version
metadata to the document or a schema-version column to the relational metadata.
Previously written versioned ciphertext is intentionally rejected rather than
normalized through a compatibility path.

The snapshot is inserted inside the same transaction that creates either a Nexi attempt or a zero-total internal attempt. PostgreSQL rejects every update. Terminal payment transactions retain every snapshot as immutable evidence of the accepted reservation and price facts; provider attempts may also need that evidence for late settlement recovery. Paid snapshots cannot be deleted. Existing historical payment attempts are intentionally not backfilled from current customer or catalog data.

The snapshot deliberately excludes phone, free-form messages, access codes, provider payloads, and payment tokens. New snapshots freeze the reservation purpose, invoice instruction, complete billing identity when applicable, and reservation email inside the encrypted blob. Historical snapshots without the explicit instruction remain valid but are ineligible for automatic issuance; those without a delivery target cannot be delivered automatically. Never infer purpose or invoice intent from mutable Dotypos fields or the legacy source buyer.

The presence of this payment-time source snapshot does not mean that the
customer requested an invoice or that an invoice was issued. Later stages must
record issuance separately. This distinction also permits a customer who did
not request an invoice during checkout to supply an immutable billing identity
after payment without mutating the original snapshot.

## Iterative implementation plan

Each stage has its own validation gate. Do not enable the next customer-facing
stage until the preceding gate passes in an isolated preview with synthetic
customer data.

### 1. Payment-time source snapshot (implemented)

Continue creating and retaining one encrypted, immutable source snapshot for
every payment attempt, whether or not the customer currently wants an invoice.
It preserves the accepted price and reservation facts as accounting evidence
and for a later invoice request.

Validate this stage with the preview gate below before beginning document
issuance.

### 2. Issued invoice and dynamic PDF (implemented)

The issued-document record is distinct from the payment-time source
snapshot. An invoice exists only when this record exists; the source snapshot
alone is not an invoice. The issued record owns the invoice number, issue time,
reservation, successful payment attempt, Dotypos customer ID, and an encrypted
immutable document JSON blob. Track individual email delivery attempts
separately from the accounting document.

At issuance, build the document JSON once by copying transaction facts from the
payment-time source snapshot and combining them with the billing identity from
the invoice request. Issuance requires that identity explicitly; never fall
back to the source snapshot's default name-only buyer. Every issued personal
invoice must include a legal name, address line 1, city, postal code, and
country. Every issued business invoice must additionally satisfy the business
identity contract, including its company ID; address line 2 and VAT ID remain
optional. Enforce this in the issued-document schema and repository boundary,
not only in the PDF renderer or customer-facing form. Never update the source
snapshot or rebuild historical buyer facts from the mutable Dotypos customer.
Enforce one invoice per successful reservation payment and make
concurrent/repeated issuance return the existing document. Allocate
`WS-FV-YYYY-NNNNNN` and insert the issued
record in one PostgreSQL transaction.

Do not issue before access-code delivery completes. Freeze
`workspace_reservations.fulfilled_at` into the issued document and use its
Prague calendar date as the invoice fulfilment date. In production this is the
timestamp recorded after the Resend delivery webhook confirms the customer
access email; it is not the cowork, meeting-room, or office reservation date.

Generate the PDF dynamically from the issued document JSON. Do not persist the
rendered PDF. Keep rendering free of current catalog, supplier, customer, or
reservation reads so the same issued snapshot always produces the same invoice
content.

Validate numbering, idempotency, strict schema decoding, Czech and English
rendering, all reservation families, and repeat generation after mutable
Dotypos customer data has changed. Visually inspect representative PDFs and
verify that neither plaintext billing data nor rendered documents appear in
Postgres, application logs, traces, or analytics.

### 3. Invoice email delivery (implemented)

The access-code email establishes fulfilment, while invoice issuance requires
that completed fulfilment timestamp. Do not predict fulfilment or attach a new
invoice to that same initial message. After fulfilment completes, render the
PDF from the issued document JSON and send a dedicated invoice follow-up to the
customer plus a matching internal copy. Send nothing when no issued invoice
exists; never attach a personal source snapshot by default.

Keep issuance and delivery idempotent. A delivery failure retains the issued
document and its number, then retries delivery of that same document instead
of issuing another invoice. Do not accept a client-provided recipient: resolve
the encrypted delivery target frozen in the payment-time source snapshot.
Persist delivery attempts separately so customer and internal deliveries can
succeed, fail, and retry independently. Historical snapshots without a frozen
recipient remain unavailable for automatic delivery.

Validate attachment filename, MIME type, content, both email templates, retry
behavior, and the no-invoice path before enabling invoice requests in the UI.

### 4. Reservation purpose and invoice request during reservation (implemented)

Add an explicit, off-by-default “Business use” switch to every reservation form,
with an adjacent “Create invoice” checkbox. Business use always checks the
invoice option; personal use leaves it optional. Explain the supplier's
different applicable EU rules in a tooltip beside the business-use label. The
selected purpose belongs to the reservation rather than the mutable
Dotypos customer. Persist it as non-PII reservation metadata so consumer and
business transactions remain distinguishable without decrypting accounting
documents, and freeze it into the encrypted checkout state and source snapshot.
Do not infer a purpose for historical reservations that predate the control.

A business reservation always requests an invoice and reveals a shared
billing-details form. Require business legal name, company ID, address line 1,
city, postal code, and country; keep address line 2 and VAT ID optional. A
personal reservation leaves “Create invoice” unchecked. Checking it reveals
only address fields and uses the reservation name as the person's legal name;
address line 2 remains optional. Do not show company name, company ID, or VAT ID
for personal use. When the personal option is unchecked, omit its invoice
request and billing fields rather than sending hidden or stale values.

Model the valid combinations as a discriminated reservation-purpose contract,
not independent booleans that can represent a business reservation without an
invoice. Never infer invoice intent from the source snapshot's required
`buyer`: legacy snapshots created a personal buyer from the reservation name
even when no invoice was requested. The explicit billing instruction governs
automation, while the issued-document row remains the sole signal that an
invoice actually exists.

Because post-order delivery must go to the email submitted for that specific
reservation rather than whatever email a mutable Dotypos customer has later,
new source snapshots retain that reservation delivery email inside the
encrypted blob. Existing snapshots without it are not automatically eligible
for self-service post-order issuance unless the original recipient can be
established through a separately verified flow.

Within Workspace, carry the request and billing details only through the
encrypted checkout state and accounting snapshots. Dotypos intentionally
remains the mutable provider system for this PII. Do not add plaintext Workspace
database columns, logs, traces, analytics properties, or email-template props
containing these values. Extend the accounting buyer schema so a personal buyer
can have a billing address and the company fields remain genuinely optional.

Purpose and billing details do not affect advertised price, so keep them out of
advertised price requests and quote fingerprints. They do affect what is
submitted and eventually issued: bind the purpose, invoice intent, and
normalized billing details to the checkout-attempt HMAC/submission fingerprint,
preserve them in every sealed pay-state and discount refresh, and restore them
when the customer navigates back to edit a reservation. A purpose or
billing-only change must not reuse stale checkout state or a source snapshot
created for different details.

Only after payment and access-code fulfilment are durable, persist the frozen
billing identity to its existing Dotypos customer record using the provider fields
`addressLine1`, `addressLine2`, `city`, `zip`, `country`, `companyName`,
`companyId`, and `vatId`. Treat the submitted billing form as authoritative for
those billing fields, including clearing omitted optional company fields, while
leaving unrelated customer data unchanged. This deliberately lets the current
Dotypos profile reflect the newest successfully invoiced billing identity;
immutable issued snapshots preserve every older invoice. Never mutate a reused
customer during unauthenticated pay-state preparation: an abandoned or spoofed
submission must not overwrite shared customer PII.

Implement this as a dedicated hard-failing ETag-protected customer PATCH. Do
not route it through the current find-or-create update behavior, which only
fills missing contact fields and deliberately tolerates an update failure. A
billing PATCH failure must stop the invoice workflow rather than snapshotting
or issuing data that was not persisted to Dotypos.

The application uses the generated ETag-protected customer PATCH modeled by the
official Dotypos contract. Re-run the authenticated live verification gate with
a dedicated synthetic customer whenever the provider contract or generated
client changes; never use a real customer for that diagnostic.

Before carrying the new fields through provider calls, extend the shared
structured-log censor for billing addresses, company ID, and VAT ID and add
regression tests for nested request/error shapes. Continue explicitly marking
snapshot plaintext and cryptographic parameters at the SQL boundary; do not
blanket-redact unrelated Drizzle parameters.

Once payment and access-code delivery succeed, always issue a business invoice
and issue a personal invoice only when the frozen personal request exists. Send
it through the delivery path from stage 3. A personal reservation without a
request continues without an invoice. Treat a zero-total internal attempt that
reaches the successful paid lifecycle as eligible in the same way as a
provider-paid attempt.

Validate conditional accessibility and stale-value removal, both locales, all
reservation families, Dotypos create and update paths, payment retries,
superseded checkouts, zero-total checkout behavior, and the guarantee that a
later billing-profile change cannot change the first invoice.

### 5. Post-order invoice request

On the reservation status page, show “Create invoice” only for an eligible
successfully paid reservation that has a readable payment-time source snapshot
and no issued invoice. The button opens a dialog containing the same shared
billing-details form as the reservation page. Keep the fields blank rather than
returning mutable Dotypos PII to a status-page visitor.

The current read-only status page is located by `orderId`; knowledge of that ID
alone must not authorize a Dotypos customer mutation or invoice issuance. Bind
the action to a signed or opaque invoice-management capability scoped to the
reservation and conveyed through a trusted checkout or reservation-email flow.
If that capability is unavailable, require email verification before accepting
billing details. Apply the existing bot protection and rate limiting in
addition to, not instead of, this authorization, and re-check payment and
invoice eligibility on the server.

The submitted recipient is never editable. After validating the form, perform
the hard-failing Dotypos billing PATCH, create or load the immutable issued
document and number idempotently, and send that document to the reservation
email address frozen in the encrypted source snapshot. A database failure after
the Dotypos update is safe to retry; an email failure retries delivery of the
already-issued document. When a historical reservation lacks a trustworthy
source snapshot or recipient, keep creation unavailable and show a support
fallback instead of reconstructing invoice facts from current provider data.

Concurrent submissions must produce one issued invoice. If delivery fails, the
status page must offer retry of the existing document rather than another
creation attempt. Once issuance succeeds, remove the creation button and show
the existing invoice state.

Validate direct and stale action submissions, pending/failed/cancelled/not-found
reservations, duplicate clicks, concurrent requests, Dotypos failure, database
failure after a Dotypos update, email failure and retry, recipient immutability,
and successful issuance after the Dotypos profile has changed since checkout.

### 6. Administration document views

Finally, add authorized administration views for all documents belonging to a
reservation and all documents associated with a Dotypos customer. Use
non-sensitive reservation, payment-attempt, and Dotypos customer IDs for lookup;
decrypt the immutable issued snapshot only inside the authorized document
boundary and generate PDFs dynamically on demand.

Validate reservation and customer grouping, authorization, missing historical
keys, schema-decoding failures, download filenames, and the absence of decrypted
PII from logs, traces, caches, and client payloads that do not render it.

## Key deployment and rotation

The active non-secret key ID is configured as:

```text
ACCOUNTING_DOCUMENT_SNAPSHOT_ACTIVE_KEY_ID=K202608
```

Each key is a separate immutable Vercel Sensitive environment variable:

```text
ACCOUNTING_DOCUMENT_SNAPSHOT_KEY_K202608=<random secret; 32 random bytes encoded as base64url is recommended>
```

The runtime requires the selected secret to be present but does not require a
particular encoding. `pgcrypto` treats it as a passphrase and derives the
encryption key itself.

Before adding a key to Vercel, store it in the company password manager or other approved recovery system. Vercel cannot reveal a Sensitive value after it has been set, and ciphertext cannot be recovered without the matching key.

Rotation is additive:

1. Generate and externally escrow a new 32-byte key.
2. Add a new immutable variable such as `ACCOUNTING_DOCUMENT_SNAPSHOT_KEY_K202609`.
3. Add its direct, statically named `process.env` access to `accountingDocumentSnapshotSecrets` in `env.ts`; Next does not transform computed environment-variable names.
4. Deploy it while the old key variable and registry entry remain available.
5. Change `ACCOUNTING_DOCUMENT_SNAPSHOT_ACTIVE_KEY_ID` to `K202609` in a second deployment.
6. Retain every historical key and registry entry for at least as long as snapshots encrypted by it must remain readable.

Never overwrite or remove an old key merely because it is no longer active. The key ID on each row selects the correct runtime variable during decryption; no endpoint may expose key material.

## Logging and tracing requirements

Application database logging preserves useful non-sensitive parameters. Confidential scalar values are explicitly wrapped with `sensitiveDatabaseParameter`, which leaves a fixed marker beside the final PostgreSQL placeholder; the query logger and Drizzle-error censor redact only those marked positions. Structured unmarked parameters still pass through the shared key-based recursive censor. Snapshot plaintext and encryption/decryption keys are always marked, their queries disable Effect tracing, and failures are immediately mapped to stable accounting errors without retaining the raw driver cause or Drizzle's parameter-bearing message.

PostgreSQL has its own logging configuration outside the application censor. Before preview and production rollout, verify the effective values of:

```sql
select name, setting
from pg_settings
where name in (
  'log_statement',
  'log_min_duration_statement',
  'log_min_duration_sample',
  'log_parameter_max_length',
  'log_parameter_max_length_on_error'
)
order by name;
```

Statement/duration logging must not be configured to record bind values. Both `log_parameter_max_length` and `log_parameter_max_length_on_error` must be `0`. Treat an unknown or unsafe managed-Postgres policy as a rollout blocker.

## Preview validation gate

After applying the generated migration to an isolated preview database:

1. Confirm `pgcrypto` is installed and the immutability trigger exists.
2. Complete one cowork, one meeting-room, and one office checkout, including a zero-total case if available.
3. Confirm each new payment attempt has exactly one snapshot row and that `encrypted_snapshot` is `bytea` with no plaintext buyer sentinel in a raw database export.
4. Read each snapshot through `AccountingDocumentSnapshotRepository` and compare it with the accepted quote and reservation-specific buyer input.
5. Confirm a retry returns the existing payment attempt/snapshot rather than replacing it.
6. Confirm updates and paid-snapshot deletes are rejected by PostgreSQL and terminal attempts retain their snapshots.
7. Run a wrong-key failure only in the isolated database after verifying its server logging settings.

Production invoice numbering should begin only when the PDF issuance stage is enabled. Use an annual PostgreSQL counter in the `Europe/Prague` year and the format `WS-FV-YYYY-NNNNNN`. Lock and increment the counter and insert the issued document in one transaction so rolled-back issuance does not consume a number and committed numbers are never reused; a non-transactional PostgreSQL `nextval` sequence does not provide that no-gap rollback behavior.
