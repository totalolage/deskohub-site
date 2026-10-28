import { Context, Data, Duration, Effect, Layer, Schema } from "effect";
import {
  type WorkspaceReservationId,
  workspaceReservationIdSchema,
} from "@/features/reservation/persistence-contracts";
import { QueuePublisher } from "@/shared/backend/queue/queue-publisher";
import { defineQueueTopic } from "@/shared/backend/queue/queue-topic";

/** One message per order: the key is the order's fulfillment idempotency. */
export const paidFulfillmentTopic = defineQueueTopic({
  topic: "workspace-paid-fulfillment",
  label: "Paid fulfillment",
  message: Schema.toStandardSchemaV1(
    Schema.Struct({ orderId: workspaceReservationIdSchema })
  ),
  publish: (input: { readonly orderId: WorkspaceReservationId }) => ({
    message: { orderId: input.orderId },
    key: `paid-fulfillment:${input.orderId}`,
  }),
  retention: Duration.hours(24),
});

export class PaidFulfillmentQueueError extends Data.TaggedError(
  "PaidFulfillmentQueueError"
)<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

interface IPaidFulfillmentQueueService {
  readonly enqueue: (input: {
    readonly orderId: WorkspaceReservationId;
  }) => Effect.Effect<void, PaidFulfillmentQueueError>;
}

/**
 * Defers paid-order fulfillment to a durable queue so request paths that learn
 * about a payment (the status page, hold cleanup) never run Dotypos, access
 * code, email, and invoice work inline. The consumer retries until
 * fulfillment leaves the pending states.
 */
export class PaidFulfillmentQueueService extends Context.Service<
  PaidFulfillmentQueueService,
  IPaidFulfillmentQueueService
>()("PaidFulfillmentQueueService") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const publisher = yield* QueuePublisher;
      return {
        enqueue: Effect.fn("paidFulfillmentQueue.enqueue")(function* (input) {
          yield* paidFulfillmentTopic.publish(input).pipe(
            Effect.provideService(QueuePublisher, publisher),
            Effect.mapError(
              (error) =>
                new PaidFulfillmentQueueError({
                  message: "Paid fulfillment could not be enqueued.",
                  cause: error.cause,
                })
            )
          );
        }),
      };
    })
  );

  static Live = this.Default.pipe(Layer.provide(QueuePublisher.Default));
}
