import {
  consumePaidFulfillmentMessage,
  paidFulfillmentRedelivery,
  paidFulfillmentTopic,
} from "@/features/checkout/backend/fulfillment";

export const maxDuration = 300;

export const POST = paidFulfillmentTopic.consume(
  "paidFulfillmentQueue",
  consumePaidFulfillmentMessage,
  paidFulfillmentRedelivery
);
