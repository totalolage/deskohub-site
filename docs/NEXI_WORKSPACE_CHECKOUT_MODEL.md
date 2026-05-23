# Nexi Workspace Checkout Data Model

This document captures the agreed data ownership and checkout flow for the Deskohub Workspace Nexi payment integration.

The goal is to keep the local payment database focused on payment state, webhook safety, and fulfillment state while storing customer PII in Dotypos customers and creating Dotypos reservations only after successful payment.

## Storage Ownership

| Store | Owns | Does Not Own |
| --- | --- | --- |
| Postgres payment DB | Pending checkout details, payment state, Nexi security token, Dotypos customer/reservation references, webhook dedupe, fulfillment status | Customer name/email/phone as separate columns, raw Nexi payloads, transient function-progress states |
| Dotypos customer | Customer PII: name, email, phone | Payment state, pending checkout state, transient payment metadata |
| Dotypos reservation | Created only after successful payment; staff-readable service details; optional machine-readable reservation metadata | Pre-payment checkout intent |
| Nexi | Hosted payment page, payment/order processing, operation results, security token origin | Workspace customer/reservation details |

## Important Constraints

- A Dotypos reservation must not exist before payment is confirmed.
- A Dotypos customer may be created before payment because Dotypos is the intended PII store.
- Do not store transient checkout or payment progress on the Dotypos customer entity.
- Do not store customer name, email, or phone as dedicated Postgres payment columns.
- Store checkout details in Postgres as `jsonb`, not as an encoded string.
- Store legal acceptance as hashes of the exact documents viewed and agreed to.
- Postgres `created_at` and `updated_at` are treated as implicit database-managed columns and are not listed in the logical table schema below.

## Payment Orders

The payment order is the local bridge between Dotypos customer PII, Nexi payment processing, and post-payment reservation creation.

Logical model:

```ts
type PaymentOrder = {
  id: string;
  provider: "nexi";

  dotyposCustomerId: string;
  dotyposReservationId: string | null;

  correlationId: string;
  securityToken: string | null;

  checkoutDetails: CheckoutDetailsJson;

  paymentStatus:
    | "created"
    | "payment_pending"
    | "paid"
    | "payment_failed"
    | "cancelled"
    | "expired";

  fulfillmentStatus:
    | "not_started"
    | "fulfilled"
    | "failed";

  lastWebhookEventId: string | null;
  lastProviderOperationId: string | null;
  lastProviderStatus: string | null;
  failureCode: string | null;

  reservationCreatedAt: Date | null;
  customerAccessEmailSentAt: Date | null;
  internalNotificationSentAt: Date | null;

  paidAt: Date | null;
  fulfilledAt: Date | null;
  fulfillmentFailedAt: Date | null;
  fulfillmentFailureCode: string | null;
};
```

Recommended relational shape:

```sql
payment_orders
- id primary key
- provider
- dotypos_customer_id not null
- dotypos_reservation_id null
- correlation_id unique not null
- security_token null
- checkout_details jsonb not null
- payment_status not null
- fulfillment_status not null
- last_webhook_event_id null
- last_provider_operation_id null
- last_provider_status null
- failure_code null
- reservation_created_at null
- customer_access_email_sent_at null
- internal_notification_sent_at null
- paid_at null
- fulfilled_at null
- fulfillment_failed_at null
- fulfillment_failure_code null
```

Database-managed timestamp columns such as `created_at` and `updated_at` may exist in the physical table, but they are implicit and not part of the connector input/output contract unless the connector chooses to expose them.

## Checkout Details JSON

`checkout_details` stores the pending booking details required to create the Dotypos reservation after payment succeeds.

It must not contain customer name, email, or phone because those belong to the Dotypos customer.

Recommended `jsonb` shape:

```ts
type CheckoutDetailsJson = {
  schema: "workspace-checkout-details";
  schemaVersion: 1;

  locale: "cs-CZ" | "en-US";

  reservation: {
    tier: "basic-day-pass" | "cowork-plus" | "profi-workstation";
    date: string;
    coffee: boolean;
    monitorOption?: "2x27" | "2x32" | "qhd-4k";
    message?: string;
  };

  payment: {
    expectedAmountMinor: number;
    currency: "CZK";
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

Notes:

- `date` and `acceptedAt` should be ISO strings.
- The legal hashes should be computed from the exact rendered/source document version that the customer agreed to.
- The checkout details JSON is the source for creating the post-payment Dotypos reservation.

## Webhook Events

A separate webhook event table is recommended for deduplication. It should not store raw payloads.

Logical model:

```ts
type WebhookEvent = {
  id: string;
  provider: "nexi";
  eventId: string;
  paymentOrderId: string | null;
  receivedAt: Date;
  processedAt: Date | null;
  status: "received" | "processed" | "failed";
  errorCode: string | null;
};
```

Recommended relational shape:

```sql
webhook_events
- id primary key
- provider not null
- event_id unique not null
- payment_order_id null references payment_orders(id)
- received_at not null
- processed_at null
- status not null
- error_code null
```

If the database has implicit `created_at` and `updated_at`, those are implementation details and do not replace `received_at` or `processed_at`, which are domain timestamps.

## Nexi Custom Field

Do not store Workspace customer or reservation details in Nexi `order.customField`.

Use one of these approaches:

- Omit `customField` if `order.orderId` is already the local `payment_orders.id`.
- Store a short non-PII reference such as `workspace:<paymentOrderId>`.

Nexi should own payment processing data only. Dotypos owns PII, and Postgres owns pending checkout/payment state.

## Dotypos Customer

Before starting the Nexi payment, find or create a Dotypos customer using the same pattern as the Bar app:

- normalize phone number
- search by email
- search by phone
- reuse an existing exact match when available
- patch missing customer fields only when needed
- create a new customer only when no match exists

Only store the resulting `dotyposCustomerId` in Postgres.

Do not write transient payment or pending checkout details to the customer entity.

## Dotypos Reservation

Create the Dotypos reservation only after Nexi confirms successful payment.

The reservation should include:

- `_customerId` set to the pre-created Dotypos customer ID
- reservation date/time derived from `checkout_details.reservation.date`
- a human-readable staff note
- optional invisible encoded reservation metadata if future machine parsing from reservation notes is useful

The human-readable note should contain only post-payment service context, for example:

```txt
Deskohub Workspace paid booking

Product: Basic Day Pass
Date: 2026-06-04
Payment: paid via Nexi
Access code: 8529

Coffee: yes
Monitor: not applicable

Customer message:
...
```

If invisible metadata is added to the reservation note, it should describe the completed reservation/access record, not the pre-payment checkout intent.

## Checkout Flow

1. The user selects a product and enters contact/reservation details.
2. The user accepts the payment/legal checkbox covering the General Terms and Conditions, Operating Rules, Privacy Policy, and no-refund-after-PIN-delivery acknowledgement.
3. The server validates the form.
4. The server finds or creates a Dotypos customer for the customer PII.
5. The server creates a `payment_orders` row:
   - `dotypos_customer_id`
   - `checkout_details` JSON
   - `payment_status = created`
   - `fulfillment_status = not_started`
   - `correlation_id`
6. The server calls Nexi `POST /orders/hpp`:
   - `order.orderId = payment_orders.id`
   - `order.customField` omitted or set to a short non-PII reference
   - `paymentSession.notificationUrl` points to the Nexi webhook route
   - `paymentSession.resultUrl` points to a payment return/status page
7. The server stores Nexi `securityToken` on the payment order.
8. The server sets `payment_status = payment_pending`.
9. The client redirects to Nexi `hostedPage`.

## Webhook Flow

1. Nexi sends a notification to `/api/webhooks/nexi`.
2. The route validates the webhook payload shape.
3. The route inserts or checks `webhook_events.event_id` for dedupe.
4. The route loads `payment_orders` by `operation.orderId`.
5. The route verifies `securityToken` against the stored payment order token.
6. The route updates payment state:
   - successful terminal result -> `payment_status = paid`, set `paid_at`
   - failed/cancelled/expired terminal result -> corresponding failed status and `failure_code`
7. If paid and `fulfillment_status = not_started`, fulfillment runs.
8. Fulfillment loads the Dotypos customer by `dotypos_customer_id`.
9. Fulfillment reads `checkout_details` from Postgres.
10. Fulfillment generates the access code through the access-code service. Initially this returns `8529`.
11. Fulfillment creates the Dotypos reservation and staff note.
12. Fulfillment stores `dotypos_reservation_id` and `reservation_created_at`.
13. Fulfillment stubs the customer access email and internal `workspace@deskohub.cz` notification.
14. Fulfillment stores the corresponding email timestamps when those stubs become real sends.
15. Fulfillment sets `fulfillment_status = fulfilled` and `fulfilled_at`.
16. If fulfillment fails after payment, set `fulfillment_status = failed`, `fulfillment_failed_at`, and `fulfillment_failure_code` so the operation can be retried or fixed manually.

## Recovery Semantics

| State | Meaning | Recovery |
| --- | --- | --- |
| `payment_pending` | Nexi payment is not terminal yet | Wait for webhook or query Nexi order status |
| `paid` + `not_started` | Payment confirmed, reservation not created | Run fulfillment |
| `paid` + `failed` | Payment confirmed, fulfillment failed | Retry fulfillment from `checkout_details` |
| `paid` + `fulfilled` | Reservation/access flow completed | Ignore duplicate successful webhooks |
| failed/cancelled/expired payment | No reservation should be created | No fulfillment |
| `dotypos_reservation_id` set but email timestamps null | Reservation exists, email work incomplete | Send missing emails only |

## Connector Contract

The database connector should expose operations around stable state transitions, not transient in-function progress.

Suggested payment-order operations:

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

Suggested webhook-event operations:

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
