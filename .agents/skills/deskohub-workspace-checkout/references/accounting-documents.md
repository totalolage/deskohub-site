# Accounting documents

Invoice policy (when an invoice is required, numbering, required billing fields, delivery, post-order requests) is in the [accounting specification](../../../../apps/deskohub-workspace/docs/accounting-document-snapshots.md). Invoice administration and manual invoices belong to the administration skill. This file covers the implementation rules.

Code: `features/accounting/`; tables `accounting_document_snapshots`, `invoices`, `invoice_number_counters`, and `invoice_email_deliveries` in `db/schema/`.

## Source snapshot

Every payment attempt, Nexi or internal, gets one encrypted, immutable source snapshot, inserted in the transaction that creates the attempt.

- PostgreSQL `pgcrypto` encrypts the JSON into `encrypted_snapshot bytea`. Only the attempt and reservation IDs, `key_id`, and creation time are plaintext.
- PostgreSQL rejects every update and any delete of a paid snapshot. Terminal attempts keep theirs as evidence and for late-payment recovery. Never backfill historical attempts from current customer or catalog data.
- The JSON is versionless and decoded strictly. Never add schema-version metadata to it or its table; older versioned ciphertext is rejected, not normalized.
- The snapshot freezes the accepted price, supplier, reservation facts, reservation purpose, invoice instruction, billing identity when given, and the reservation email as the delivery target. It excludes phone, free-form messages, access codes, provider payloads, and payment tokens.
- A snapshot is not an invoice request and not an invoice. Read invoice intent only from the explicit frozen instruction, never from mutable Dotypos fields or the legacy `buyer`, which older snapshots filled from the reservation name even without a request. Snapshots without the instruction are ineligible for automatic issuance; snapshots without a delivery target can't be delivered automatically.

## Purpose and billing in checkout

- Model purpose and invoice request as a discriminated contract, not independent booleans: business always requests an invoice; personal requests one optionally. Persist the purpose as non-PII reservation metadata.
- When a personal request is off, omit billing fields instead of sending hidden or stale values.
- Carry billing details only through the encrypted checkout state and the snapshot. Never add plaintext columns, logs, traces, analytics properties, or email-template props for them.
- Keep purpose and billing out of advertised-price requests and quote fingerprints. Bind them into the checkout-attempt key, preserve them in every sealed Pay state and discount refresh, and restore them when the customer edits the reservation.

## Issued invoice

The `invoices` row, not the snapshot, proves an invoice exists. It owns the number, issue time, reservation, payment attempt, Dotypos customer ID, and an encrypted immutable document JSON.

1. Issue only after access-code delivery completes. Freeze `workspace_reservations.fulfilled_at` and use its Prague date as the fulfilment date, not the reservation date.
2. Persist the frozen billing identity to Dotypos first through the hard-failing, ETag-protected `updateCustomerBillingDetails` (`addressLine1`, `addressLine2`, `city`, `zip`, `country`, `companyName`, `companyId`, `vatId`; omitted optional fields are cleared, other customer data is untouched). Never route this through find-or-create, which tolerates update failure. A PATCH failure stops issuance. Never mutate a customer during unauthenticated Pay-state preparation.
3. Build the document JSON once from the snapshot's transaction facts plus the explicit billing identity. Never fall back to the snapshot's name-only buyer. Enforce required billing fields in the issued-document schema and repository, not only in the form or renderer.
4. Lock and increment the annual Prague-year counter and insert the invoice in one transaction (`formatInvoiceNumber`, `WS-FV-YYYY-NNNNNN`). A rolled-back issuance consumes no number; a non-transactional `nextval` sequence can't give that guarantee.

One invoice per reservation payment is enforced by unique indexes; repeated or concurrent issuance returns the existing invoice. Issue a business invoice always and a personal one only when the frozen request exists. Zero-total internal attempts qualify like provider-paid ones.

Render the PDF on demand from the issued JSON. Never persist the PDF or read current catalog, supplier, customer, or reservation data while rendering.

## Delivery

- Send a dedicated invoice follow-up after fulfilment, never as part of the access-code email, plus an internal copy.
- Resolve the recipient from the snapshot's frozen delivery target. Never accept a client-provided recipient.
- Track customer and internal deliveries separately in `invoice_email_deliveries`; each logical send has its own stable provider idempotency key. A delivery failure retries the same document, never reissues.

## Post-order request

The protected page (`app/[locale]/(site)/(minimal-header)/reservation/invoice/[orderId]/page.tsx`, action `features/accounting/actions/manage-post-order-invoice.ts`) reuses the reservation-access token claims and secret with its own route.

- Verify the capability before any database or provider lookup, then recheck locale, payment, fulfilment, active attempt, snapshot, recipient, purpose, and eligibility on the server. Run BotID before every mutation.
- Offer creation only for an eligible paid personal reservation without a request or invoice. With an invoice, offer only a customer resend, never another internal copy.
- Sequence: Dotypos billing PATCH, idempotent issuance, delivery to the frozen email. A database failure after the PATCH is safe to retry.
- Without a trustworthy snapshot or recipient, show the support fallback instead of rebuilding facts from current data.

## Keys

`ACCOUNTING_DOCUMENT_SNAPSHOT_ACTIVE_KEY_ID` names the active key. Each key is its own immutable Vercel Sensitive variable, `ACCOUNTING_DOCUMENT_SNAPSHOT_KEY_<ID>`; `pgcrypto` treats it as a passphrase. Each row's `key_id` selects the key for decryption.

To rotate:

1. Generate a new 32-byte key and escrow it in the company password manager before adding it to Vercel. Vercel can't reveal it later, and ciphertext is unrecoverable without it.
2. Add the variable and a statically named `process.env` entry in `accountingDocumentSnapshotSecrets` in `env.ts`. Next doesn't inline computed env names.
3. Deploy with the old key still present.
4. Switch `ACCOUNTING_DOCUMENT_SNAPSHOT_ACTIVE_KEY_ID` in a second deployment.
5. Keep every old key and registry entry while any snapshot it encrypted must stay readable.

## SQL logging

- Mark snapshot plaintext and every key with `sensitiveDatabaseParameter` (see `features/accounting/backend/accounting-snapshot-sql.ts`). Don't blanket-redact unrelated parameters.
- Encryption and decryption queries disable tracing and map failures straight to stable accounting errors without the raw driver cause or the parameter-bearing Drizzle message.
- Extend the shared structured-log censor (`shared/backend/logging/censorship.ts`) and its nested request and error tests before carrying a new billing field through provider calls.
- PostgreSQL server logging sits outside the application censor. Before relying on encryption in a new database, confirm statement and duration logging don't record bind values and that `log_parameter_max_length` and `log_parameter_max_length_on_error` are `0`. Treat an unknown managed-Postgres policy as a blocker.
