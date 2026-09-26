import { Schema } from "effect";

export const orderKinds = ["reservation"] as const;

export const orderKindSchema = Schema.Literals(orderKinds).annotate({
  identifier: "OrderKind",
  description: "The fulfillment family of a Deskohub order.",
});

export type OrderKind = typeof orderKindSchema.Type;

export const orderPaymentStates = [
  "not_started",
  "pending",
  "paid",
  "failed",
  "cancelled",
  "expired",
] as const;

export type OrderPaymentState = (typeof orderPaymentStates)[number];

export const orderFulfillmentStates = [
  "not_started",
  "processing",
  "awaiting_delivery",
  "fulfilled",
  "failed",
] as const;

export type OrderFulfillmentState = (typeof orderFulfillmentStates)[number];

export const orderIdSchema = Schema.NonEmptyString.pipe(
  Schema.brand("OrderId")
).annotate({
  identifier: "OrderId",
  description: "Opaque identifier for a persisted order.",
});

export type OrderId = typeof orderIdSchema.Type;
