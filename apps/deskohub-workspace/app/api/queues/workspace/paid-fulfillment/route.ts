import { Effect, Layer } from "effect";
import {
  paidFulfillmentRedelivery,
  paidFulfillmentTopic,
  processPaidFulfillmentMessage,
  WorkspacePaidFulfillmentService,
} from "@/features/checkout/backend/fulfillment";
import { FulfillmentLedger } from "@/features/checkout/backend/fulfillment/fulfillment-ledger.repository";

export const maxDuration = 300;

const ConsumerLive = Layer.mergeAll(
  WorkspacePaidFulfillmentService.Live,
  FulfillmentLedger.Live
);

export const POST = paidFulfillmentTopic.consume(
  "paidFulfillmentQueue",
  (message) =>
    processPaidFulfillmentMessage(message).pipe(Effect.provide(ConsumerLive)),
  paidFulfillmentRedelivery
);
