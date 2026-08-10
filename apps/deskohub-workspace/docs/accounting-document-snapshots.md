# Accounting document snapshots

This is the first implementation stage for reservation invoices. It freezes the accepted price, supplier identity, buyer identity, and reservation facts alongside the payment attempt. PostgreSQL encrypts the serialized, versioned JSON with `pgcrypto`; the database stores only a `bytea` ciphertext plus non-PII lookup metadata.

PDF generation, email attachments, invoice issuance/numbering, and administration views are intentionally later stages. They must read this snapshot rather than reconstruct billing facts from mutable Dotypos customer or product data.

## Current boundary

`accounting_document_snapshots` contains one immutable row per payment attempt:

- `payment_attempt_id`
- `workspace_reservation_id`
- `schema_version`
- `key_id`
- `encrypted_snapshot bytea`
- `created_at`

The snapshot is inserted inside the same transaction that creates either a Nexi attempt or a zero-total internal attempt. PostgreSQL rejects every update. Deletion is permitted only after the owning payment attempt has reached `failed`, `cancelled`, or `expired`, and the terminal payment transaction removes that no-longer-needed snapshot. Paid snapshots cannot be deleted. Existing historical payment attempts are intentionally not backfilled from current customer or catalog data.

The snapshot deliberately excludes email, phone, free-form messages, access codes, provider payloads, and payment tokens. A business buyer contract is supported, but the current reservation UI does not yet collect a reservation-specific business name, company ID, VAT ID, and address. Until that input is added and signed into the checkout state, checkout creates a personal buyer snapshot from the submitted customer name. Do not enable automatic business-invoice issuance on the assumption that the currently blank Dotypos company fields are complete.

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
2. Complete one cowork and one meeting-room checkout, including a zero-total case if available.
3. Confirm each new payment attempt has exactly one snapshot row and that `encrypted_snapshot` is `bytea` with no plaintext buyer sentinel in a raw database export.
4. Read each snapshot through `AccountingDocumentSnapshotRepository` and compare it with the accepted quote and reservation-specific buyer input.
5. Confirm a retry returns the existing payment attempt/snapshot rather than replacing it.
6. Confirm updates and paid-snapshot deletes are rejected by PostgreSQL, while a terminal unsuccessful attempt removes its snapshot transactionally.
7. Run a wrong-key failure only in the isolated database after verifying its server logging settings.

Production invoice numbering should begin only when the PDF issuance stage is enabled. Use an annual, PostgreSQL-allocated sequence in the `Europe/Prague` year and the format `WS-FV-YYYY-NNNNNN`; allocate and insert the issued document in one transaction so rolled-back issuance does not consume a number and committed numbers are never reused.
