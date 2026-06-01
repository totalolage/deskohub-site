# Nexi Workspace Database Specification

This document specifies the intended shape and purpose of the local database used by the Deskohub Workspace Nexi checkout flow. It is a handoff document for implementing and connecting the database layer.

The source checkout model is [`NEXI_WORKSPACE_CHECKOUT_MODEL.md`](./NEXI_WORKSPACE_CHECKOUT_MODEL.md). If this database spec and the checkout model disagree, treat the checkout model as the product/source-of-truth document and update this spec accordingly.

## Purpose

The database is a local payment and fulfillment ledger for Workspace checkout. It exists to safely bridge these external systems:

- Dotypos customer records, which own customer PII.
- Nexi hosted payment pages and payment operation results.
- Dotypos reservations, which are created only after payment succeeds.
- Post-payment fulfillment, including access-code delivery and internal notification tracking.

The database must support these operational needs:

- Persist a pending checkout intent without storing customer name, email, or phone as local columns.
- Link each checkout to the Dotypos customer created or reused before payment.
- Store the Nexi security token returned during hosted payment page creation so notifications that include a token can be compared before provider verification.
- Deduplicate Nexi webhook deliveries.
- Track stable payment and fulfillment states for recovery and retries.
- Preserve legal acceptance evidence through document hashes inside `checkout_details`.
- Allow fulfillment to be resumed from durable state after a process failure.

The database is not a CRM, reservation system, or raw webhook archive. It should store only the durable local state required for payment safety and fulfillment recovery.

## Ownership Boundaries

| Data | Owner | Local DB Behavior |
| --- | --- | --- |
| Customer name, email, phone | Dotypos customer | Store only `dotypos_customer_id` locally. Do not add separate PII columns. |
| Pending reservation details | Local Postgres DB | Store in `payment_orders.checkout_details` as `jsonb`. |
| Payment page/session state | Nexi and local DB | Store local order ID, payment status, operation IDs/statuses, and `security_token`. |
| Raw Nexi notification payloads | Nexi | Do not store raw payloads or sensitive optional notification extras in the database or application logs. |
| Webhook dedupe state | Local Postgres DB | Store normalized event identity and processing result in `webhook_events`. |
| Final reservation | Dotypos reservation | Store only `dotypos_reservation_id` and fulfillment timestamps locally. |
| Access/email fulfillment state | Local Postgres DB | Store stable sent/completed/failure timestamps. |

## Required Database

Use Postgres. The checkout details must be stored as `jsonb`, not as an encoded string.

Physical tables may include database-managed `created_at` and `updated_at` columns. Those columns are implementation details unless the connector intentionally exposes them. They do not replace domain timestamps such as `paid_at`, `received_at`, or `processed_at`.

## Tables

The initial database requires two logical tables:

- `payment_orders`: one row per local Workspace checkout/payment order.
- `webhook_events`: one row per Nexi webhook event identity for deduplication and processing status.

Additional operational tables are not required for the first implementation. Avoid adding tables for transient in-function progress unless there is a concrete recovery requirement that cannot be represented by the stable states below.

## Table: `payment_orders`

`payment_orders` is the durable bridge between Dotypos customers, Nexi orders, and post-payment Dotypos reservation creation.

### Logical Columns

| Column | Type | Required | Purpose |
| --- | --- | --- | --- |
| `id` | text/uuid | yes | Local payment order ID. This should be sent to Nexi as `order.orderId`. |
| `provider` | text/enum | yes | Payment provider. Initial allowed value: `nexi`. |
| `dotypos_customer_id` | text | yes | Dotypos customer record that owns the customer PII. |
| `dotypos_reservation_id` | text | no | Dotypos reservation created after successful payment. Null before fulfillment creates it. |
| `correlation_id` | text | yes | Unique cross-system tracing ID for logs and support. |
| `security_token` | text | no | Nexi security token returned during hosted payment page creation. Used to compare notification/order `securityToken` when Nexi supplies one. CEE `GET /orders/{orderId}` does not always echo the token on successful payments, so token absence in the verified order response is not by itself a failed verification. |
| `checkout_details` | jsonb | yes | Pending booking details and legal evidence needed for post-payment reservation creation. Must not contain customer PII. |
| `payment_status` | text/enum | yes | Stable payment state. |
| `fulfillment_status` | text/enum | yes | Stable post-payment fulfillment state. |
| `last_webhook_event_id` | text | no | Last webhook event identity applied to this payment order. |
| `last_provider_operation_id` | text | no | Last Nexi operation ID observed for this order. |
| `last_provider_status` | text | no | Last provider payment/operation status observed. |
| `failure_code` | text | no | Normalized payment failure/cancel/expiry code, if payment ended unsuccessfully. |
| `reservation_created_at` | timestamptz | no | Domain timestamp for successful Dotypos reservation creation. |
| `customer_access_email_sent_at` | timestamptz | no | Domain timestamp for sending the customer access email. Null means not sent. |
| `internal_notification_sent_at` | timestamptz | no | Domain timestamp for sending the internal notification. Null means not sent. |
| `paid_at` | timestamptz | no | Domain timestamp when payment became successful/terminal. |
| `fulfilled_at` | timestamptz | no | Domain timestamp when all required fulfillment work completed. |
| `fulfillment_failed_at` | timestamptz | no | Domain timestamp for the most recent fulfillment failure. |
| `fulfillment_failure_code` | text | no | Normalized code describing why fulfillment failed. |

### Allowed Values

`provider`:

- `nexi`

`payment_status`:

- `created`: local order exists, Nexi payment session has not yet been fully attached or marked pending.
- `payment_pending`: customer has been sent to Nexi or payment is awaiting a terminal result.
- `paid`: Nexi confirmed successful payment.
- `payment_failed`: Nexi returned a failed terminal result.
- `cancelled`: checkout/payment was cancelled.
- `expired`: checkout/payment expired.

`fulfillment_status`:

- `not_started`: no post-payment fulfillment has completed.
- `processing`: internal claim/lease state for a paid fulfillment worker; used to prevent concurrent workers from duplicating reservation or notification work.
- `fulfilled`: Dotypos reservation and required notifications/access work are complete.
- `failed`: payment succeeded, but fulfillment failed and needs retry/manual repair.

### Required Constraints

The implementation should enforce these constraints in the database where practical:

- `id` is the primary key.
- `provider` is not null and initially constrained to `nexi`.
- `dotypos_customer_id` is not null.
- `correlation_id` is not null and unique.
- `checkout_details` is not null and has type `jsonb`.
- `payment_status` is not null and constrained to the allowed values.
- `fulfillment_status` is not null and constrained to the allowed values.
- `dotypos_reservation_id` is nullable before fulfillment.
- `paid_at` should be non-null when `payment_status = 'paid'`.
- `fulfilled_at` should be non-null when `fulfillment_status = 'fulfilled'`.
- `fulfillment_failed_at` and `fulfillment_failure_code` should be non-null when `fulfillment_status = 'failed'`.

Recommended but optional check constraints:

- `dotypos_reservation_id is not null` when `fulfillment_status = 'fulfilled'`.
- `reservation_created_at is not null` when `dotypos_reservation_id is not null`.
- `fulfillment_status = 'not_started'` for non-paid terminal payment states unless a future requirement says otherwise.

### Recommended Indexes

- Primary key index on `id`.
- Unique index on `correlation_id`.
- Index on `(payment_status, fulfillment_status)` for operational recovery queries.
- Index on `dotypos_customer_id` for support/debug lookup.
- Optional index on `dotypos_reservation_id` if support tooling needs reverse lookup from Dotypos reservation IDs.

### Suggested SQL Shape

This is an implementation guide, not a mandatory migration file:

```sql
create table payment_orders (
  id text primary key,
  provider text not null check (provider in ('nexi')),
  dotypos_customer_id text not null,
  dotypos_reservation_id text null,
  correlation_id text not null unique,
  security_token text null,
  checkout_details jsonb not null,
  payment_status text not null check (
    payment_status in (
      'created',
      'payment_pending',
      'paid',
      'payment_failed',
      'cancelled',
      'expired'
    )
  ),
  fulfillment_status text not null check (
    fulfillment_status in ('not_started', 'processing', 'fulfilled', 'failed')
  ),
  last_webhook_event_id text null,
  last_provider_operation_id text null,
  last_provider_status text null,
  failure_code text null,
  reservation_created_at timestamptz null,
  customer_access_email_sent_at timestamptz null,
  internal_notification_sent_at timestamptz null,
  paid_at timestamptz null,
  fulfilled_at timestamptz null,
  fulfillment_failed_at timestamptz null,
  fulfillment_failure_code text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index payment_orders_recovery_idx
  on payment_orders (payment_status, fulfillment_status);

create index payment_orders_dotypos_customer_idx
  on payment_orders (dotypos_customer_id);

create index payment_orders_dotypos_reservation_idx
  on payment_orders (dotypos_reservation_id)
  where dotypos_reservation_id is not null;
```

## Table: `webhook_events`

`webhook_events` exists for Nexi webhook deduplication and normalized processing status. It must not store raw notification payloads or sensitive optional notification extras.

Nexi's official notification API body is a JSON object with optional top-level `eventId`, `eventTime`, `securityToken`, and `operation` fields. Workspace processing requires `operation.orderId` to associate the notification with `payment_orders.id`. The operation fields used by the application are `operationId`, `operationType`, `operationResult`, `operationTime`, `operationAmount`, and `operationCurrency`.

Nexi may include sensitive optional data such as `customerInfo`, payment instrument details, warnings, and `additionalData`; those values are outside the local database contract and must not be persisted as raw payload data. `eventId` is optional. When absent, derive a deterministic event identity from non-secret operation fields and event/operation time. `securityToken` is optional in the notification API schema, although HPP progress-notification docs describe it as present; compare it with the stored token if supplied, but still verify final payment state through Nexi `GET /orders/{orderId}`.

Notifications are triggers, not authoritative payment-state sources. Do not model flat local webhook shapes such as a top-level `orderId`, `order.orderId`, or `payment.orderId`; the supported association field is the official `operation.orderId`. Do not claim or depend on signature, MAC, or special header validation unless Nexi documents and implementation add it later.

For implicit-accounting CEE hosted payments, successful order verification can return `operationType = AUTHORIZATION` and `operationResult = EXECUTED`, with both authorized and captured amounts populated. Database transitions should treat that as `payment_status = 'paid'` after expected order ID, amount, and currency checks pass.

### Logical Columns

| Column | Type | Required | Purpose |
| --- | --- | --- | --- |
| `id` | text/uuid | yes | Local webhook event row ID. |
| `provider` | text/enum | yes | Webhook provider. Initial allowed value: `nexi`. |
| `event_id` | text | yes | Stable provider event identity used for dedupe. Must be unique. |
| `payment_order_id` | text | no | Local payment order associated with the event, if known. |
| `received_at` | timestamptz | yes | Domain timestamp when the webhook was received. |
| `processed_at` | timestamptz | no | Domain timestamp when processing completed successfully. |
| `status` | text/enum | yes | Processing state of the webhook event row. |
| `error_code` | text | no | Normalized processing error code if processing failed. |

### Allowed Values

`provider`:

- `nexi`

`status`:

- `received`: event was accepted for processing.
- `processed`: event was processed successfully.
- `failed`: event processing failed and may need retry/manual inspection.

### Required Constraints

- `id` is the primary key.
- `provider` is not null and initially constrained to `nexi`.
- `event_id` is not null and unique.
- `payment_order_id` is nullable but should reference `payment_orders(id)` when present.
- `received_at` is not null.
- `status` is not null and constrained to the allowed values.
- `processed_at` should be non-null when `status = 'processed'`.
- `error_code` should be non-null when `status = 'failed'`.

### Recommended Indexes

- Primary key index on `id`.
- Unique index on `event_id`.
- Index on `payment_order_id` for tracing all webhook events tied to an order.
- Index on `(status, received_at)` for retry/operations views.

### Suggested SQL Shape

```sql
create table webhook_events (
  id text primary key,
  provider text not null check (provider in ('nexi')),
  event_id text not null unique,
  payment_order_id text null references payment_orders(id),
  received_at timestamptz not null,
  processed_at timestamptz null,
  status text not null check (status in ('received', 'processed', 'failed')),
  error_code text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index webhook_events_payment_order_idx
  on webhook_events (payment_order_id)
  where payment_order_id is not null;

create index webhook_events_status_received_idx
  on webhook_events (status, received_at);
```

## `checkout_details` JSON Contract

`payment_orders.checkout_details` is the durable source for creating the Dotypos reservation after payment succeeds. It must be `jsonb` and must not include customer name, email, or phone.

Required shape:

```ts
type CheckoutDetailsJson = {
  schema: "workspace-checkout-details";
  schemaVersion: 1;

  locale: "cs-CZ" | "en-US";

  reservation: {
    tier: "basic" | "plus" | "profi";
    date: string;
    coffee: boolean;
    monitorOption?: "2x27-qhd" | "2x32-qhd" | "2x27-4k" | "2x32-4k";
    message?: string;
  };

  payment: {
    expectedPrice: {
      value: number;
      exponent: number; // Integer decimal exponent, 0..20
      currency: string;
    };
  };

  legal: {
    acceptedAt: string;
    documents: {
      termsAndConditions: LegalDocumentHash;
      operatingRules: LegalDocumentHash;
      privacyPolicy: LegalDocumentHash;
    };
    acknowledgements: {
      operatingRules: true;
      noRefundAfterPinDelivery: true;
      privacyPolicy: true;
    };
  };

  fulfillment: {
    accessCodePolicy: "workspace-static-v1";
  };
};

type LegalDocumentHash = {
  path: string;
  hash: string;
  hashAlgorithm: "sha256";
};
```

Validation expectations:

- `schema` must be `workspace-checkout-details`.
- `schemaVersion` must be `1` for the initial connector.
- `reservation.date` and `legal.acceptedAt` must be ISO strings.
- `payment.expectedPrice.currency` must be an uppercase ISO 4217 currency code.
- `payment.expectedPrice.value` and `payment.expectedPrice.exponent` must match the server-calculated amount for the selected tier/options. `payment.expectedPrice.exponent` must be an integer from 0 to 20, matching the ECMA-402 currency fraction digit range used for formatting.
- Legal hashes must be hashes of the exact document versions accepted by the customer.
- If `monitorOption` is present, it must be valid for the selected product tier according to server-side checkout rules.
- Product catalog entries must not define access-code policy. The payment order persistence layer assigns `checkout_details.fulfillment.accessCodePolicy` at insert time so each row records the global policy used for that order.
- Future access-code policy changes should update the hard-coded insert/storage-boundary value, and the persisted type/schema if a new literal is supported.

The database may enforce only broad JSON checks. The application/connector should perform full schema validation before insert and before fulfillment.

## State Model

### Creation

When the server validates checkout input and finds or creates the Dotypos customer, insert a `payment_orders` row with:

- `provider = 'nexi'`
- `dotypos_customer_id` set
- `correlation_id` set
- `checkout_details` set
- `payment_status = 'created'`
- `fulfillment_status = 'not_started'`

After Nexi hosted payment page creation succeeds:

- Store `security_token`.
- Set `payment_status = 'payment_pending'`.

### Payment Terminal States

Webhook processing may transition payment state only after `NexiService.verifyPaymentOutcome` verifies the outcome through Nexi `GET /orders/{orderId}` and local expected facts. The notification's `operationResult` is useful context but is not authoritative by itself.

Verified webhook-triggered processing may transition payment state to:

- `paid`, with `paid_at`, `last_provider_operation_id`, and `last_provider_status` set.
- `payment_failed`, `cancelled`, or `expired`, with `failure_code` when available.

Once a payment reaches a terminal unsuccessful state, no Dotypos reservation should be created.

### Fulfillment States

Fulfillment is allowed only when:

- `payment_status = 'paid'`
- `fulfillment_status = 'not_started'` or `fulfillment_status = 'failed'` for retry

Before performing external fulfillment work, a worker should atomically claim the order by changing `fulfillment_status` to `processing`. `processing` is an internal claim/lease state for paid fulfillment concurrency; it is not a customer-facing outcome.

Successful fulfillment should set:

- `dotypos_reservation_id`
- `reservation_created_at`
- `customer_access_email_sent_at` once the customer access email is actually sent
- `internal_notification_sent_at` once the internal notification is actually sent
- `fulfillment_status = 'fulfilled'`
- `fulfilled_at`

If fulfillment fails after payment succeeds, set:

- `fulfillment_status = 'failed'`
- `fulfillment_failed_at`
- `fulfillment_failure_code`

Do not add separate database rows to track transient in-function steps such as "currently creating reservation" unless a future concurrent-worker design requires additional locking or leases beyond `fulfillment_status = 'processing'`.

## Recovery Queries

The implementation should make these operational queries easy:

| Scenario | Query Shape | Expected Action |
| --- | --- | --- |
| Payment pending too long | `payment_status = 'payment_pending'` | Wait, show pending status, or query Nexi order status. |
| Paid but not fulfilled | `payment_status = 'paid' and fulfillment_status = 'not_started'` | Run fulfillment. |
| Paid fulfillment in progress | `payment_status = 'paid' and fulfillment_status = 'processing'` | Let the active fulfillment attempt finish or inspect if the claim is stale. |
| Paid but fulfillment failed | `payment_status = 'paid' and fulfillment_status = 'failed'` | Retry fulfillment from `checkout_details` or repair manually. |
| Fulfilled order | `payment_status = 'paid' and fulfillment_status = 'fulfilled'` | Ignore duplicate successful webhooks. |
| Reservation exists but emails incomplete | `dotypos_reservation_id is not null` plus null email timestamp | Send only the missing emails. |
| Failed webhook processing | `webhook_events.status = 'failed'` | Inspect `error_code`; retry if safe. |

## Connector Contract

The connector should expose stable state-transition operations. It should not expose generic table mutation as the primary application API.

Recommended payment-order repository:

```ts
interface PaymentOrderRepository {
  create(input: {
    id: string;
    dotyposCustomerId: string;
    correlationId: string;
    checkoutDetails: CheckoutDetailsJson;
  }): Promise<PaymentOrder>;

  attachNexiSession(input: {
    id: string;
    securityToken: string;
  }): Promise<void>;

  findById(id: string): Promise<PaymentOrder | null>;

  markPaymentPending(id: string): Promise<void>;

  markPaid(input: {
    id: string;
    providerOperationId: string;
    providerStatus: string;
    paidAt: Date;
  }): Promise<void>;

  markFailed(input: {
    id: string;
    providerOperationId?: string;
    providerStatus: string;
    failureCode?: string;
  }): Promise<void>;

  attachDotyposReservation(input: {
    id: string;
    dotyposReservationId: string;
    reservationCreatedAt: Date;
  }): Promise<void>;

  markCustomerAccessEmailSent(input: {
    id: string;
    sentAt: Date;
  }): Promise<boolean>;

  markInternalNotificationSent(input: {
    id: string;
    sentAt: Date;
  }): Promise<boolean>;

  markFulfilled(input: {
    id: string;
    fulfilledAt: Date;
  }): Promise<boolean>;

  markFulfillmentFailed(input: {
    id: string;
    failedAt: Date;
    failureCode: string;
  }): Promise<void>;
}
```

Recommended webhook-event repository:

```ts
interface WebhookEventRepository {
  insertReceived(input: {
    provider: "nexi";
    eventId: string;
    paymentOrderId?: string;
    receivedAt: Date;
  }): Promise<"inserted" | "duplicate">;

  markProcessed(eventId: string): Promise<void>;

  markFailed(input: {
    eventId: string;
    errorCode: string;
  }): Promise<void>;
}
```

### Connector Semantics

The connector should implement idempotent or guarded updates where repeated webhooks/retries are expected:

- `insertReceived` must be atomic and return `duplicate` for an existing `event_id`.
- `markPaid` should be safe to call for an already-paid order with the same provider result.
- `attachDotyposReservation` should not overwrite an existing different `dotypos_reservation_id` without an explicit repair path.
- Email timestamp methods should return `false` if the timestamp was already set, so callers can avoid duplicate sends or detect races.
- `markFulfilled` should verify the required fulfillment artifacts exist before setting `fulfilled`.
- Fulfillment retry should rely on `checkout_details`, `dotypos_customer_id`, and existing timestamp/reservation fields to avoid duplicating work.

## Transaction And Concurrency Expectations

Webhook handling and fulfillment may receive duplicate or concurrent requests. The database layer should protect the durable state from double processing.

Recommended behavior:

- Insert `webhook_events.event_id` using an atomic unique constraint/upsert.
- Load and update the related `payment_orders` row inside a transaction when applying payment state.
- Use guarded updates for fulfillment transitions, for example claim work only when `payment_status = 'paid'` and `fulfillment_status in ('not_started', 'failed')`, then require `fulfillment_status = 'processing'` for fulfillment side-effect markers and completion.
- Avoid creating a second Dotypos reservation if `dotypos_reservation_id` is already set.
- Treat email timestamp columns as idempotency markers for notification sends.

External side effects, such as Dotypos reservation creation and email sends, cannot be fully rolled back by a database transaction. The connector should therefore make each durable marker explicit and allow retry logic to continue from the last confirmed marker.

## Data Retention And Privacy

Privacy constraints are part of the database contract:

- Do not add local columns for customer name, email, or phone.
- Do not store or log raw Nexi notification payloads, notification `securityToken`, `customerInfo`, payment instrument details, warnings, or `additionalData`.
- Do not store full Workspace customer or reservation details in Nexi `customField`.
- Keep reservation/customer PII in Dotypos.
- Store legal evidence as document paths and hashes, not full rendered legal documents.
- Treat `checkout_details.reservation.message` as customer-provided content and avoid copying it into logs unnecessarily.

Retention duration is not defined by this spec. Until a retention policy exists, keep payment orders and webhook events as operational audit records.

## Out Of Scope

The initial database implementation does not need to provide:

- A customer profile table.
- A reservation table separate from Dotypos.
- Raw webhook payload archiving.
- A generic event-sourcing system.
- Local storage of Nexi hosted page URLs after redirect unless a concrete recovery flow requires it.
- Background job leasing tables unless concurrent worker execution creates a demonstrated need.

## Implementation Checklist

- Create `payment_orders` with `checkout_details jsonb` and stable payment/fulfillment state columns.
- Create `webhook_events` with unique `event_id` and no raw payload column.
- Add constraints for allowed provider/status values.
- Add recovery and lookup indexes.
- Implement repository methods as state transitions rather than generic writes.
- Validate `CheckoutDetailsJson` before insert and before fulfillment.
- Ensure checkout creation stores Dotypos customer ID but not customer PII.
- Ensure Nexi webhook handling compares notification `securityToken` against the stored order token when present, and always verifies the final outcome through Nexi `GET /orders/{orderId}` before applying payment state.
- Ensure Dotypos reservation creation happens only after `payment_status = 'paid'`.
- Ensure duplicate webhooks and retry attempts do not duplicate reservations or notifications.
