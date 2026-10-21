import { Effect, Layer } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import {
  paidFulfillmentRedelivery,
  processPaidFulfillmentMessage,
  WorkspacePaidFulfillmentService,
} from "@/features/checkout/backend/fulfillment";
import { WorkspaceReservationRepository } from "@/features/reservation/backend/workspace-reservation.repository";
import { defineQueueConsumer } from "@/shared/backend/queue/queue-consumer";

export const maxDuration = 300;

const ConsumerLive = Layer.mergeAll(
  WorkspacePaidFulfillmentService.Live,
  WorkspaceReservationRepository.Default.pipe(
    Layer.provide(WorkspaceDatabase.Default)
  )
);

export const POST = defineQueueConsumer(
  "paidFulfillmentQueue",
  (message) =>
    processPaidFulfillmentMessage(message).pipe(Effect.provide(ConsumerLive)),
  paidFulfillmentRedelivery
);
