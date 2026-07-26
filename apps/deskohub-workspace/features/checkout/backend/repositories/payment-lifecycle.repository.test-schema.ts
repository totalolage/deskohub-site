import { sql } from "drizzle-orm";

export const paymentLifecycleTestSchemaStatements = `
  create function uuid_generate_v7() returns uuid language sql volatile
    as 'select gen_random_uuid()';
  create table workspace_reservations (
    id text primary key,
    checkout_session_key text not null,
    checkout_attempt_key text not null unique,
    correlation_id text not null unique,
    dotypos_customer_id text not null,
    dotypos_reservation_id text,
    reservation_state text not null,
    payment_state text not null,
    fulfillment_state text not null,
    active_payment_attempt_id text,
    active_payment_evidence_conflicted boolean not null default false,
    payment_reconciliation_attempt_id text,
    payment_reconciliation_claim_id text,
    payment_reconciliation_claim_expires_at timestamptz,
    reservation_hold_expires_at timestamptz,
    paid_at timestamptz,
    failure_code text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  );
  create table payment_attempts (
    id text primary key,
    workspace_reservation_id text not null references workspace_reservations(id),
    provider text not null,
    provider_order_id text not null unique,
    admission_version integer not null default 1,
    pricing_fingerprint text,
    displayed_discount_ids jsonb,
    provider_start_lease_id text,
    provider_start_lease_expires_at timestamptz,
    provider_evidence_conflicted boolean not null default false,
    security_token text,
    state text not null,
    amount_value integer not null,
    amount_exponent integer not null,
    currency text not null,
    provider_redirect_url text,
    last_webhook_event_id text,
    last_provider_operation_id text,
    last_provider_status text,
    failure_code text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  );
  create table discounts (
    id text primary key,
    labels jsonb not null,
    percentage_basis_points integer,
    fixed_amount_value integer,
    fixed_amount_exponent integer,
    fixed_amount_currency text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  );
  create table discount_product_targets (
    discount_id text not null references discounts(id),
    product_identity jsonb not null,
    primary key (discount_id, product_identity)
  );
  create table discount_codes (
    id text primary key,
    discount_id text not null references discounts(id),
    code text not null unique,
    enabled boolean not null,
    valid_from timestamptz,
    valid_until timestamptz,
    max_uses integer,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  );
  create table discount_code_customers (
    code_id text not null references discount_codes(id),
    dotypos_customer_id text not null,
    primary key (code_id, dotypos_customer_id)
  );
  create table discount_applications (
    id text primary key default gen_random_uuid()::text,
    payment_attempt_id text not null references payment_attempts(id),
    workspace_reservation_id text not null references workspace_reservations(id),
    sequence integer not null,
    public_discount_id text not null,
    label text not null,
    adjustment jsonb not null,
    product_identity jsonb not null,
    subtotal_before_value integer not null,
    subtotal_before_exponent integer not null,
    subtotal_before_currency text not null,
    applied_amount_value integer not null,
    applied_amount_exponent integer not null,
    applied_amount_currency text not null,
    subtotal_after_value integer not null,
    subtotal_after_exponent integer not null,
    subtotal_after_currency text not null,
    expires_at timestamptz,
    countdown_starts_at timestamptz,
    provenance jsonb not null,
    created_at timestamptz not null default now(),
    unique (payment_attempt_id, sequence)
  );
  create table discount_code_redemptions (
    id text primary key default gen_random_uuid()::text,
    code_id text not null references discount_codes(id),
    application_id text not null references discount_applications(id),
    payment_attempt_id text not null references payment_attempts(id),
    dotypos_customer_id text not null,
    state text not null,
    reservation_expires_at timestamptz not null,
    reserved_at timestamptz not null default now(),
    redeemed_at timestamptz,
    released_at timestamptz,
    release_reason text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (application_id),
    unique (payment_attempt_id)
  );
  create unique index discount_code_redemptions_active_customer_unique_idx
    on discount_code_redemptions(code_id, dotypos_customer_id)
    where state in ('reserved', 'redeemed');
  create table payment_paid_events (
    id text primary key default gen_random_uuid()::text,
    payment_attempt_id text not null references payment_attempts(id),
    workspace_reservation_id text not null references workspace_reservations(id),
    paid_at timestamptz not null,
    created_at timestamptz not null default now(),
    unique (payment_attempt_id)
  );
  create table payment_evidence_conflicts (
    id text primary key default gen_random_uuid()::text,
    payment_attempt_id text not null references payment_attempts(id) on delete cascade,
    conflict_code text not null,
    first_observed_at timestamptz not null default now(),
    unique (payment_attempt_id, conflict_code)
  )
`
  .split(";")
  .map((statement) => statement.trim())
  .filter(Boolean)
  .map(sql.raw);
