# Nexi Workspace Checkout Data Model

This document captures the agreed data ownership and checkout flow for the Deskohub Workspace Nexi payment integration.

The goal is to keep the local payment database focused on payment state, webhook safety, and fulfillment state while storing customer PII in Dotypos customers and creating Dotypos reservations only after successful payment.

## Storage Ownership

| Store | Owns | Does Not Own |
| --- | --- | --- |
| Postgres payment DB | Pending checkout details, payment state, Nexi security token returned with the HPP session, Dotypos customer/reservation references, webhook dedupe, fulfillment status | Customer name/email/phone as separate columns, raw Nexi notification payloads, transient function-progress states |
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
    | "processing"
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

Notes:

- `date` and `acceptedAt` should be ISO strings.
- The legal hashes should be computed from the exact rendered/source document version that the customer agreed to.
- The checkout details JSON is the source for creating the post-payment Dotypos reservation.
- Product catalog entries do not define access-code policy. `fulfillment.accessCodePolicy` is assigned by the payment order persistence layer when `payment_orders.checkout_details` is inserted, and records the global policy used for that order.
- Future access-code policy changes are made by changing the hard-coded insert/storage-boundary value, and by updating the persisted type/schema if a new persisted literal is supported.

## Webhook Events

A separate webhook event table is recommended for deduplication. It should not store raw notification payloads or sensitive optional notification extras.

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
Access code: generated by the access-code service

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
   - `paymentSession.actionType = PAY`
   - `paymentSession.notificationUrl` points to the Nexi webhook route
   - `paymentSession.resultUrl` points to a payment return/status page
7. The server stores Nexi `securityToken` on the payment order.
8. The server sets `payment_status = payment_pending`.
9. The client redirects to Nexi `hostedPage`.

## Webhook Flow

Nexi server-to-server outcome notifications are enabled when the HPP session request includes `paymentSession.notificationUrl`. The official notification API body is a JSON object with optional top-level `eventId`, `eventTime`, `securityToken`, and `operation` fields. For Workspace processing, `operation.orderId` is required because it identifies `payment_orders.id`.

The operation fields we use are `operationId`, `operationType`, `operationResult`, `operationTime`, `operationAmount`, and `operationCurrency`. Nexi notifications can also include sensitive optional data such as `customerInfo`, payment instrument details, warnings, and `additionalData`; do not persist or log the raw notification payload or those extras.

`@deskohub/nexi` owns provider-level webhook contracts and pure interpretation: strict official-envelope decoding, normalization that trims optional strings and converts blanks to `undefined`, event identity derivation, notification security-token comparison, provider failure-status classification, and metadata extraction from provider verification results. Workspace owns persistence, dedupe insertion, payment-order transitions, expected amount encoding from `checkout_details`, fulfillment, route responses, app failure codes, and app logging.

`eventId` is optional in the official schema. If Nexi omits it, derive a deterministic event identity from non-secret operation fields and event/operation time. `securityToken` is also optional in the notification API schema, although the HPP docs describe progress notifications with a `securityToken`. If it is present, compare it with the stored HPP token before provider verification. If it is absent, still treat the notification only as a trigger and verify through Nexi before changing local payment state.

No signature, MAC, or header-validation mechanism is confirmed in the verified Nexi docs, and none is implemented here. The authoritative payment result comes from `NexiService.verifyPaymentOutcome`, which calls Nexi `GET /orders/{orderId}` and compares local expected facts such as order ID, amount, and currency. It also compares the stored security token when Nexi echoes one, but CEE order verification does not always return the HPP `securityToken` on successful payments, so absence of an echoed token is not itself a failure.

For implicit-accounting HPP payments, Nexi CEE can report a successful paid payment as `operationType = AUTHORIZATION` and `operationResult = EXECUTED`, while both `authorizedAmount` and `capturedAmount` are present on the order. Treat that combination as a successful terminal payment for Workspace. Do not require `operationType = CAPTURE` for this flow.

1. Nexi sends a JSON notification to `/api/webhooks/nexi`.
2. The route validates the official notification envelope and requires `operation.orderId`.
3. The route inserts or checks `webhook_events.event_id` for dedupe, using the optional `eventId` or a deterministic derived identity.
4. The route loads `payment_orders` by `operation.orderId`.
5. If notification `securityToken` is present, the route compares it against the stored payment order token.
6. The route calls `NexiService.verifyPaymentOutcome` / Nexi `GET /orders/{orderId}`; the unverified notification status is not authoritative.
7. The route updates payment state from verified provider facts:
   - successful terminal result -> `payment_status = paid`, set `paid_at`
   - failed/cancelled/expired terminal result -> corresponding failed status and `failure_code`
8. If paid and `fulfillment_status = not_started` or `failed`, fulfillment claims the order by setting `fulfillment_status = processing`.
9. `processing` is an internal claim/lease state used to prevent concurrent paid fulfillment workers from duplicating reservation or notification work.
10. Fulfillment loads the Dotypos customer by `dotypos_customer_id`.
11. Fulfillment reads `checkout_details` from Postgres.
12. Fulfillment generates the access code through the access-code service.
13. Fulfillment creates the Dotypos reservation and staff note.
14. Fulfillment stores `dotypos_reservation_id` and `reservation_created_at`.
15. Fulfillment stubs the customer access email and internal `workspace@deskohub.cz` notification.
16. Fulfillment stores the corresponding email timestamps when those stubs become real sends.
17. Fulfillment sets `fulfillment_status = fulfilled` and `fulfilled_at`.
18. If fulfillment fails after payment, set `fulfillment_status = failed`, `fulfillment_failed_at`, and `fulfillment_failure_code` so the operation can be retried or fixed manually.

## Recovery Semantics

| State | Meaning | Recovery |
| --- | --- | --- |
| `payment_pending` | Nexi payment is not terminal yet | Wait for webhook or query Nexi order status |
| `paid` + `not_started` | Payment confirmed, reservation not created | Run fulfillment |
| `paid` + `processing` | Payment confirmed, fulfillment worker has claimed the order | Let the active fulfillment attempt finish or inspect if the lease is stale |
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
