# Workspace discount-code operations

Discount codes are managed directly in the Workspace Postgres database until an administration surface exists. Perform changes in the intended environment, inside a transaction, and verify the rows before committing. Production changes follow the normal staged-deployment and migration sequence.

## Data model and safety rules

- `discounts` stores a source-neutral percentage or fixed-money benefit.
- `discount_product_targets` stores at least one product target for every usable benefit.
- `discount_codes` stores scheduling, enabled state, and the optional global-use limit.
- `discount_code_customers` is an allowlist. Zero rows for a code means every customer is eligible; one or more rows restrict eligibility to those Dotypos customer IDs.
- `discount_applications` and `discount_code_redemptions` are application-managed audit records. Inspect them, but never insert, edit, or delete them manually.

Codes must already be canonical when written directly: trim them, convert them to ASCII uppercase, and verify they match `[A-Z0-9][A-Z0-9_-]{2,63}`. Do not use database-side `upper()` to conceal an invalid input.

Validity is half-open. `valid_from` is inclusive and `valid_until` is exclusive: a code is eligible when `valid_from <= now() AND now() < valid_until`. Either bound may be `NULL`. A `NULL` `max_uses` means unlimited global uses; a non-null value must be positive. Every code is still limited to one successful redemption per Dotypos customer.

Multiple codes may reference the same row in `discounts`. Their schedules, allowlists, global limits, and customer redemptions remain independent because those rules belong to each code.

## Schedule a sale in Google Calendar

The dedicated sales calendar owns only when a sale is active. The referenced `discounts` row owns the customer-facing label, adjustment, and product targets.

Create the discount and all required targets first, then copy its UUID into the Calendar event description. The trimmed description must be exactly the UUID, with no marker, TOML, prose, or second identifier:

```text
019bfe6e-8ef0-7def-8b16-55cfbc82edb7
```

The event must have a non-empty title for operators and must be an all-day event. Its title is not customer-facing. Google Calendar's end date is exclusive; an event displayed through 1 August ends at Prague midnight starting 2 August. Checkout exposes that instant as the sale expiry and begins the countdown exactly 24 hours earlier.

Cancelled events and events without a description are ignored. Any non-empty description that is not exactly one valid UUID, or a UUID that does not resolve to a complete stored discount, is an operational configuration error and checkout fails closed. Cancel or delete the event to stop the sale; do not delete a definition while an active event references it.

Interactive quotes may retain the resolved event and database definition for up to 60 seconds. Final payment revalidation always reads both Calendar and Postgres freshly. Editing a shared `discounts` row changes every calendar event and code that references it.

## Create a percentage code

This `psql` example creates an initially disabled 50% Basic-tier code, adds its required target, and only then enables it. Use explicit timezone offsets for scheduled instants.

```sql
BEGIN;

INSERT INTO discounts (
  label,
  percentage_basis_points
) VALUES (
  'Letní sleva 50 %',
  5000
)
RETURNING id AS discount_id \gset

INSERT INTO discount_product_targets (
  discount_id,
  product_key,
  product_identity
) VALUES (
  :'discount_id',
  'cowork:basic',
  '{"kind":"cowork","tier":"basic"}'::jsonb
);

INSERT INTO discount_codes (
  discount_id,
  code,
  enabled,
  valid_from,
  valid_until,
  max_uses
) VALUES (
  :'discount_id',
  'LETO50',
  false,
  '2026-07-15T00:00:00+02:00'::timestamptz,
  '2026-08-01T00:00:00+02:00'::timestamptz,
  100
)
RETURNING id AS code_id \gset

UPDATE discount_codes
SET enabled = true, updated_at = now()
WHERE id = :'code_id';

SELECT id, code, enabled, valid_from, valid_until, max_uses
FROM discount_codes
WHERE id = :'code_id';

COMMIT;
```

For all cowork tiers, insert the three explicit targets `cowork:basic`, `cowork:plus`, and `cowork:profi`, with matching product JSON. There is no wildcard target.

For a fixed-money benefit, leave `percentage_basis_points` null and set the complete fixed tuple instead:

```sql
INSERT INTO discounts (
  label,
  fixed_amount_value,
  fixed_amount_exponent,
  fixed_amount_currency
) VALUES (
  'Sleva 100 Kč',
  10000,
  2,
  'CZK'
);
```

Exactly one adjustment variant is required. Fixed values must be positive, their exponent non-negative, and their currency an uppercase three-letter code.

## Disable, schedule, or limit a code

Disable instead of deleting so historical applications and claims remain attributable:

```sql
UPDATE discount_codes
SET enabled = false, updated_at = now()
WHERE code = 'LETO50';
```

Change scheduling or capacity explicitly, then inspect the result before commit:

```sql
UPDATE discount_codes
SET
  valid_from = '2026-07-20T09:00:00+02:00'::timestamptz,
  valid_until = '2026-07-31T18:00:00+02:00'::timestamptz,
  max_uses = 50,
  updated_at = now()
WHERE code = 'LETO50';
```

Setting `max_uses` to `NULL` removes only the global limit. It does not remove the one-redemption-per-customer rule.

## Manage product targets and customer allowlists

Add targets only with a matching canonical key and strict product snapshot:

```sql
INSERT INTO discount_product_targets (
  discount_id,
  product_key,
  product_identity
)
SELECT
  discount_id,
  'cowork:plus',
  '{"kind":"cowork","tier":"plus"}'::jsonb
FROM discount_codes
WHERE code = 'LETO50';
```

Add the first allowlist row to switch a code from unrestricted to restricted:

```sql
INSERT INTO discount_code_customers (code_id, dotypos_customer_id)
SELECT id, 'DOTYPOS_CUSTOMER_ID'
FROM discount_codes
WHERE code = 'LETO50';
```

Delete individual allowlist rows to remove customers. Deleting every row makes the code unrestricted again, so disable the code first if that is not intended.

## Inspect usage and claims

Capacity counts claims in `reserved` or `redeemed`; released claims remain as audit history and do not consume capacity.

```sql
SELECT
  dc.code,
  dc.max_uses,
  count(*) FILTER (WHERE dcr.state IN ('reserved', 'redeemed')) AS capacity_used,
  count(*) FILTER (WHERE dcr.state = 'redeemed') AS redeemed,
  count(*) FILTER (WHERE dcr.state = 'released') AS released
FROM discount_codes AS dc
LEFT JOIN discount_code_redemptions AS dcr ON dcr.code_id = dc.id
WHERE dc.code = 'LETO50'
GROUP BY dc.id, dc.code, dc.max_uses;
```

Inspect a payment attempt without querying customer contact fields or Workspace access-code values:

```sql
SELECT
  da.payment_attempt_id,
  da.sequence,
  da.public_discount_id,
  da.label,
  da.applied_amount_value,
  da.applied_amount_exponent,
  da.applied_amount_currency,
  dcr.state AS claim_state,
  dcr.reservation_expires_at,
  dcr.redeemed_at,
  dcr.released_at,
  dcr.release_reason
FROM discount_applications AS da
LEFT JOIN discount_code_redemptions AS dcr ON dcr.application_id = da.id
WHERE da.payment_attempt_id = 'PAYMENT_ATTEMPT_ID'
ORDER BY da.sequence;
```

Application snapshots and claim history are immutable operational evidence. Repair them only through a reviewed application migration or dedicated repair workflow.
