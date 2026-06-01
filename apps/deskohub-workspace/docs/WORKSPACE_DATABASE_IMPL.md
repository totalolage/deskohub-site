Deskohub Nexi Workspace Database: Handoff & Implementation Guide

1 Introduction

This document is a handoff and product specification for implementing the local database that powers the Deskohub Workspace Nexi checkout flow.  It correlates the detailed requirements in the uploaded database specification with research on Neon, Drizzle ORM and Effect.  The aim is to guide engineers in building a reliable, type‑safe and maintainable database layer.

Key points:

* Database scope: Provide a durable payment & fulfilment ledger for Nexi checkout, bridging Dotypos customer records, Nexi payment sessions and post‑payment fulfilment tasks.  The database must not store customer PII or raw webhook payloads.
* Environment separation: There are two environments: production, and development/preview.  Production uses its own Neon branch and holds real customer data.  The development/preview environment uses a separate branch shared by local development and preview deployments.  This separation keeps production isolated while avoiding the complexity of multiple test branches.
* Implementation stack: Postgres on Neon, Drizzle ORM for schema/migrations, and Effect for typed service composition.  Use a Node runtime; Edge runtimes are not needed.

2 Background research highlights

* Neon branching: Neon supports creating branches from an existing database.  Some hosting integrations can automatically create preview branches for each deployment【670099003675080†L216-L233】.  When connecting directly, you lose auto‑preview branches but can still create branches manually via the Neon API or CLI【324857154152910†L289-L301】.  Branches provide isolated data sets; our design assigns each environment its own branch, rather than forking preview or dev from production.
* Connection management: When using Node runtime in a serverless or short‑lived environment, you need to ensure that PostgreSQL connections are cleaned up when functions are suspended.  Use a pg.Pool from the pg package and implement or adopt a helper to drain connections on shutdown.  If you are not in a serverless environment, a standard pool is sufficient.【204858883908508†L315-L334】.
* Drizzle ORM and Neon: Drizzle supports connecting to Neon via pg pools.  You instantiate a pool with the DATABASE_URL, then create a Drizzle client by passing the pool【791238445107445†L167-L186】.  This pattern is well suited for Node environments and supports interactive transactions and full SQL features.
* Effect integration: Effect can wrap the database client in a layer to provide dependency injection, typed error handling and explicit resource management.  We will use this to ensure service composition remains pure and testable.

3 Database design summary

The uploaded specification defines two tables: payment_orders and webhook_events.  Their roles and constraints are summarised below.

3.1 payment_orders

This table records one row per local checkout/payment order.  It links a Dotypos customer, a Nexi payment session and the eventual Dotypos reservation.  Key points:

Column	Required?	Notes
id (PK)	Yes	Local order ID. Sent to Nexi as order.orderId.
provider	Yes	Only nexi for now.
dotypos_customer_id	Yes	References Dotypos customer. Do not store name/email/phone.
correlation_id	Yes, unique	Cross‑system tracing ID.
dotypos_reservation_id	No	Set after successful payment and reservation creation.
security_token	No	Nexi security token used to validate webhooks.
checkout_details	Yes (jsonb)	JSON contract capturing reservation options, payment amount and legal acceptance. Must not include PII.
payment_status	Yes (enum)	created, payment_pending, paid, payment_failed, cancelled, expired.
fulfillment_status	Yes (enum)	not_started, processing, fulfilled, failed. `processing` is an internal claim/lease state for paid fulfillment concurrency.
last_webhook_event_id, last_provider_operation_id, last_provider_status	No	Tracking of last provider event for idempotency.
failure_code	No	Normalised failure/expiry code.
paid_at, reservation_created_at, customer_access_email_sent_at, internal_notification_sent_at, fulfilled_at, fulfillment_failed_at	No	Domain timestamps describing payment and fulfilment milestones.  Each timestamp should only be set once.
fulfillment_failure_code	No	Normalised code when fulfilment fails.

Constraints:

* id is primary key; correlation_id is unique.
* provider must be nexi.
* checkout_details must be valid JSON and not null.
* payment_status and fulfillment_status must be within the enumerated values.
* When payment_status = 'paid', paid_at must be set; when fulfillment_status = 'fulfilled', fulfilled_at and dotypos_reservation_id must be set.

Recommended indexes:

* PK on id (default).
* Unique index on correlation_id.
* Index on (payment_status, fulfillment_status) for recovery queries.
* Index on dotypos_customer_id and optionally on dotypos_reservation_id (partial index where not null).

3.2 webhook_events

Stores one row per Nexi webhook event identity for deduplication and tracking.

Column	Required?	Notes
id (PK)	Yes	Local row ID.
provider	Yes	Only nexi.
event_id	Yes, unique	Stable provider event ID for dedupe.
payment_order_id	No	Foreign key to payment_orders(id).  Nullable because some events may arrive before an order is created.
received_at	Yes	Timestamp when the webhook was received.
status	Yes (enum)	received, processed, failed.
processed_at	No	Timestamp when processing succeeded. Must be set when status = processed.
error_code	No	Normalised error code when status = failed.

Constraints:

* event_id is unique.
* status must be one of the enumerated values.
* processed_at is non‑null when status = 'processed'; error_code is non‑null when status = 'failed'.

Recommended indexes:

* PK on id.
* Unique index on event_id.
* Index on payment_order_id (partial where not null).
* Index on (status, received_at) for retry monitoring.

3.3 checkout_details JSON contract

checkout_details must conform to a strict JSON schema summarised below:

type CheckoutDetailsJson = {
  schema: "workspace-checkout-details";
  schemaVersion: 1;
  locale: "cs-CZ" | "en-US";
  reservation: {
    tier: "basic" | "plus" | "profi";
    date: string;                // ISO date for the booking
    coffee: boolean;
    monitorOption?: "2x27-qhd" | "2x32-qhd" | "2x27-4k" | "2x32-4k";
    message?: string;
  };
  payment: {
    expectedPrice: {
      value: number;    // Integer amount in currency minor units/scaled units
      exponent: number; // Integer decimal exponent used to derive the major amount, 0..20
      currency: string; // Uppercase ISO 4217 currency code
    };
  };
  legal: {
    acceptedAt: string;          // ISO timestamp when terms were accepted
    documents: {
      termsAndConditions: LegalDocumentHash;
      operatingRules:    LegalDocumentHash;
      privacyPolicy:     LegalDocumentHash;
    };
    acknowledgements: {
      operatingRules:          true;
      noRefundAfterPinDelivery: true;
      privacyPolicy:            true;
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

The application must validate this object before inserting it into the database and again before fulfilment.  The database itself should enforce only that checkout_details is non‑null and of type jsonb; detailed schema validation belongs in the application layer. Product catalog entries do not define access-code policy. The payment order persistence layer assigns `checkout_details.fulfillment.accessCodePolicy` at insert time so each row records the global policy used for that order. Future policy changes should update the hard-coded insert/storage-boundary value, and the persisted type/schema if a new literal is supported.

4 Environment strategy (production, development/preview)

4.1 Branches and connection strings

Under the new requirement there are only two environments:

1. Production: This uses its own Neon branch (e.g. prod) and holds real checkout data.  Only production deployments should connect to this branch.  Migrations are applied here after being tested elsewhere.
2. Development/Preview: Both local development and preview deployments share a single Neon branch (e.g. dev).  This branch contains test data and is isolated from production.  Preview deployments connect to this branch by default.  Local developers also connect to this branch via a connection string in .env.local.

This setup simplifies branch management while still protecting production data.  If you need to reset the development/preview branch, you can drop and recreate it using the Neon CLI or API.  Optionally seed it with test data, but do not copy production data unless strictly necessary and after anonymising any sensitive fields.

To create the branches, use the Neon CLI or API.  For example:

# create a production branch
neon branch create prod --project-id <project-id>
# create a development/preview branch
neon branch create dev --project-id <project-id>

4.2 Environment variables

Each deployment must have the appropriate connection string stored in DATABASE_URL.  For example:

Environment	Variable	Value
Production	DATABASE_URL	connection string to the production Neon branch
Development/Preview	DATABASE_URL	connection string to the development/preview Neon branch

Never embed the connection string in source code.  Use environment variables configured in your deployment pipeline or hosting platform, and .env.local for local development.  For preview deployments, set DATABASE_URL to the development/preview branch connection string via your CI/CD environment settings.

5 Implementation with Drizzle and Effect

5.1 Schema definition and migrations

Use Drizzle ORM to define the tables and generate migrations.  Drizzle provides strongly typed table definitions and type‑safe SQL.  Below is a suggested implementation:

// src/db/schema/paymentOrders.ts
import { pgTable, text, jsonb, timestamptz, uuid } from "drizzle-orm/pg-core";
export const paymentOrders = pgTable("payment_orders", {
  id: text("id").primaryKey(),
  provider: text("provider").notNull().$type<"nexi">(),
  dotyposCustomerId: text("dotypos_customer_id").notNull(),
  dotyposReservationId: text("dotypos_reservation_id"),
  correlationId: text("correlation_id").notNull().unique(),
  securityToken: text("security_token"),
  checkoutDetails: jsonb("checkout_details").notNull(),
  paymentStatus: text("payment_status").notNull().$type<
    | "created"
    | "payment_pending"
    | "paid"
    | "payment_failed"
    | "cancelled"
    | "expired"
  >(),
  fulfillmentStatus: text("fulfillment_status").notNull().$type<
    | "not_started"
    | "processing"
    | "fulfilled"
    | "failed"
  >(),
  lastWebhookEventId: text("last_webhook_event_id"),
  lastProviderOperationId: text("last_provider_operation_id"),
  lastProviderStatus: text("last_provider_status"),
  failureCode: text("failure_code"),
  reservationCreatedAt: timestamptz("reservation_created_at"),
  customerAccessEmailSentAt: timestamptz("customer_access_email_sent_at"),
  internalNotificationSentAt: timestamptz("internal_notification_sent_at"),
  paidAt: timestamptz("paid_at"),
  fulfilledAt: timestamptz("fulfilled_at"),
  fulfillmentFailedAt: timestamptz("fulfillment_failed_at"),
  fulfillmentFailureCode: text("fulfillment_failure_code"),
  createdAt: timestamptz("created_at").notNull().defaultNow(),
  updatedAt: timestamptz("updated_at").notNull().defaultNow(),
});
// src/db/schema/webhookEvents.ts
export const webhookEvents = pgTable("webhook_events", {
  id: text("id").primaryKey(),
  provider: text("provider").notNull().$type<"nexi">(),
  eventId: text("event_id").notNull().unique(),
  paymentOrderId: text("payment_order_id").references(() => paymentOrders.id),
  receivedAt: timestamptz("received_at").notNull(),
  processedAt: timestamptz("processed_at"),
  status: text("status").notNull().$type<"received" | "processed" | "failed">(),
  errorCode: text("error_code"),
  createdAt: timestamptz("created_at").notNull().defaultNow(),
  updatedAt: timestamptz("updated_at").notNull().defaultNow(),
});

Run Drizzle migrations to create these tables.  Migration scripts should also add the recommended indexes.

5.2 Database client

Use the Node pg module to create a connection pool, then use Drizzle to create a typed client.  Wrap the client in an Effect Layer for dependency injection.  If your deployment environment suspends functions (e.g. serverless), implement or adopt a helper to gracefully drain the pool connections when the function is frozen.  Otherwise, a standard pg.Pool is sufficient【204858883908508†L315-L334】.

// src/db/client.ts
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { attachDatabasePool } from "@vercel/functions";
import { paymentOrders, webhookEvents } from "./schema";
const pool = new Pool({ connectionString: process.env.DATABASE_URL! });
// If you have a function suspension mechanism, ensure the pool is drained on shutdown.
// For example, call pool.end() in your framework’s on-close hook.
export const db = drizzle(pool, {
  schema: { paymentOrders, webhookEvents },
});

5.3 Effect service layer

Define services using Effect’s Context.Tag pattern to abstract away the database.  Repositories implement the state‑transition operations defined in the specification (e.g. create, markPaymentPending, markPaid, markFailed, attachDotyposReservation, markFulfilled, markFulfillmentFailed).  Each method should perform an atomic transaction when updating state and must be idempotent.

Example skeleton for PaymentOrderRepository:

// src/services/paymentOrderRepo.ts
import { Context, Effect, Layer } from "effect";
import { db } from "../db/client";
import { paymentOrders } from "../db/schema";
export class PaymentOrderRepository extends Context.Tag(
  "PaymentOrderRepository",
)<{
  create: (input: {
    id: string;
    dotyposCustomerId: string;
    correlationId: string;
    checkoutDetails: CheckoutDetailsJson;
  }) => Effect.Effect<never, Error, PaymentOrder>;
  markPaymentPending: (id: string) => Effect.Effect<never, Error, void>;
  markPaid: (input: {
    id: string;
    providerOperationId: string;
    providerStatus: string;
    paidAt: Date;
  }) => Effect.Effect<never, Error, void>;
  // ... other methods
}>() {}
export const PaymentOrderRepoLive = Layer.effect(
  PaymentOrderRepository,
  Effect.succeed({
    create: (input) =>
      Effect.tryPromise(() =>
        db.insert(paymentOrders).values({
          id: input.id,
          provider: "nexi",
          dotyposCustomerId: input.dotyposCustomerId,
          correlationId: input.correlationId,
          checkoutDetails: input.checkoutDetails,
          paymentStatus: "created",
          fulfillmentStatus: "not_started",
        }),
      ),
    // implement other methods with appropriate checks and idempotency
    markPaymentPending: (id) =>
      Effect.tryPromise(() =>
        db.update(paymentOrders)
          .set({ paymentStatus: "payment_pending" })
          .where(eq(paymentOrders.id, id)),
      ),
    markPaid: ({ id, providerOperationId, providerStatus, paidAt }) =>
      Effect.tryPromise(() =>
        db.update(paymentOrders)
          .set({
            paymentStatus: "paid",
            lastProviderOperationId: providerOperationId,
            lastProviderStatus: providerStatus,
            paidAt: paidAt,
          })
          .where(eq(paymentOrders.id, id)),
      ),
    // ... implement remaining methods
  }),
);

Effect makes it easy to compose these services with other services (e.g. sending emails or creating reservations) while keeping error channels explicit.  Ensure that each repository method enforces the state machine described in the specification (e.g. do not mark an order as paid if it’s already failed; do not create a reservation twice).  Use transactions where multiple updates need to be atomic.

6 Fulfilment logic and idempotency

Processing webhooks and fulfilment can involve concurrent or duplicate requests.  To maintain idempotency and consistency:

* Webhook dedupe: Insert into webhook_events using a unique constraint on event_id.  If insertion fails due to existing event_id, treat it as a duplicate and skip processing.【324857154152910†L289-L301】
* Atomic updates: When applying provider results to a payment order (marking paid or failed), wrap the read‑modify‑write in a transaction to prevent race conditions.  Check the current status before updating.
* Guarded fulfilment: Claim fulfilment only when payment_status = 'paid' and fulfillment_status ∈ { 'not_started', 'failed' }, then set fulfillment_status = 'processing' before external side effects.  `processing` is an internal claim/lease state that prevents concurrent workers from duplicating reservation or notification work. Ensure that dotypos_reservation_id is null before creating a reservation.
* Idempotent notifications: Use the timestamp columns (customer_access_email_sent_at, internal_notification_sent_at) as idempotency markers.  Repository methods should return a boolean indicating whether a timestamp was set, allowing the caller to skip duplicate sends.

7 Operational considerations

7.1 Migrations

* Run migrations first on the development/preview branch.  Verify that the code works with the new schema before applying it to production.
* The development/preview branch is an independent environment.  Do not automatically refresh it from production when running migrations.  You may choose to reset or seed the branch manually if needed, but treat its data as distinct from production.
* Apply migrations using Drizzle’s CLI (e.g. drizzle-kit migrate).

7.2 Backups and retention

* Configure regular Neon backups for your production branch.  Branches can be recreated from backups when needed.
* Consider retention policies for payment_orders and webhook_events tables based on legal and business requirements.  Until a policy is defined, keep all rows for auditability.

7.3 Security and privacy

* Do not store customer name, email, phone or other PII in the database.  Only store dotypos_customer_id and checkout_details fields that exclude PII.
* Do not store or log raw Nexi notification payloads, notification security tokens, customerInfo, payment instrument details, warnings, additionalData, or other sensitive optional notification extras. Capture only the normalised event identity and processing status.
* Treat checkout_details.reservation.message as user content.  Avoid logging it unless necessary for debugging.

8 Summary

By following this guide, you can implement a robust database layer for the Deskohub Nexi checkout flow.  The design enforces clear boundaries on what data is stored locally, ensures durable payment and fulfilment state tracking, and supports recovery and retries.  Using Drizzle ORM and Effect provides strong type safety and explicit error handling.  Manual management of Neon branches allows you to maintain two isolated environments: a production branch for real data, and a combined development/preview branch for testing and preview deployments.  Each environment has its own branch and data; there is no automatic forking from production.

If you later choose to use a hosting platform integration that automatically creates preview branches, the architecture remains compatible.  Such integrations can create dedicated preview databases for each deployment【670099003675080†L216-L233】, at which point you might switch from a shared development/preview branch to per‑preview branches.  Until then, manual branch management and a single development/preview branch provide equivalent isolation for your two‑environment workflow.
