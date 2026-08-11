import { Schema } from "effect";

export const checkoutSessionIdSchema = Schema.NonEmptyString.pipe(
  Schema.brand("CheckoutSessionId")
).annotate({
  identifier: "CheckoutSessionId",
  description: "Browser-generated identifier for one checkout session.",
});
export type CheckoutSessionId = typeof checkoutSessionIdSchema.Type;

export const checkoutAttemptIdSchema = Schema.NonEmptyString.pipe(
  Schema.brand("CheckoutAttemptId")
).annotate({
  identifier: "CheckoutAttemptId",
  description: "Browser-generated identifier for one checkout submission.",
});
export type CheckoutAttemptId = typeof checkoutAttemptIdSchema.Type;

export const checkoutSessionKeySchema = Schema.NonEmptyString.pipe(
  Schema.brand("CheckoutSessionKey")
).annotate({
  identifier: "CheckoutSessionKey",
  description:
    "One-way persisted lookup key derived from a checkout session identifier.",
});
export type CheckoutSessionKey = typeof checkoutSessionKeySchema.Type;

export const checkoutAttemptKeySchema = Schema.NonEmptyString.pipe(
  Schema.brand("CheckoutAttemptKey")
).annotate({
  identifier: "CheckoutAttemptKey",
  description:
    "One-way persisted idempotency key derived from a checkout attempt.",
});
export type CheckoutAttemptKey = typeof checkoutAttemptKeySchema.Type;

export const paymentAttemptIdSchema = Schema.NonEmptyString.pipe(
  Schema.brand("PaymentAttemptId")
).annotate({
  identifier: "PaymentAttemptId",
  description: "Opaque identifier for a persisted payment attempt.",
});
export type PaymentAttemptId = typeof paymentAttemptIdSchema.Type;

export const storedWebhookEventIdSchema = Schema.NonEmptyString.pipe(
  Schema.brand("StoredWebhookEventId")
).annotate({
  identifier: "StoredWebhookEventId",
  description: "Opaque database identifier for a persisted webhook event.",
});
export type StoredWebhookEventId = typeof storedWebhookEventIdSchema.Type;

const createCheckoutIdentifier = () =>
  globalThis.crypto?.randomUUID?.() ??
  `checkout-${Date.now()}-${Math.random().toString(36).slice(2)}`;

const decodeCheckoutSessionId = Schema.decodeUnknownSync(
  checkoutSessionIdSchema
);
const decodeCheckoutAttemptId = Schema.decodeUnknownSync(
  checkoutAttemptIdSchema
);

export const createCheckoutSessionId = (): CheckoutSessionId =>
  decodeCheckoutSessionId(createCheckoutIdentifier());

export const createCheckoutAttemptId = (): CheckoutAttemptId =>
  decodeCheckoutAttemptId(createCheckoutIdentifier());

export const promoteCheckoutAttemptToSessionId = (
  attemptId: CheckoutAttemptId
): CheckoutSessionId => checkoutSessionIdSchema.make(attemptId);
