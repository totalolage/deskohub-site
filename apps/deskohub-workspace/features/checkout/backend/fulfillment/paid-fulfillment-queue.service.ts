import { DuplicateMessageError, send } from "@vercel/queue";
import { Context, Data, Effect, Layer } from "effect";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";

export const paidFulfillmentQueueTopic = "workspace-paid-fulfillment";

export class PaidFulfillmentQueueError extends Data.TaggedError(
  "PaidFulfillmentQueueError"
)<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

class DuplicatePaidFulfillmentMessageError extends Data.TaggedError(
  "DuplicatePaidFulfillmentMessageError"
) {}

interface IPaidFulfillmentQueueService {
  readonly enqueue: (input: {
    readonly orderId: WorkspaceReservationId;
  }) => Effect.Effect<void, PaidFulfillmentQueueError>;
}

/**
 * Defers paid-order fulfillment to a durable queue so request paths that learn
 * about a payment (the status page, hold cleanup) never run Dotypos, access
 * code, email, and invoice work inline. One message per order: the consumer
 * retries until fulfillment leaves the pending states.
 */
export const makePaidFulfillmentQueueService = (
  sendMessage: typeof send = send
): IPaidFulfillmentQueueService => ({
  enqueue: Effect.fn("paidFulfillmentQueue.enqueue")(function* (input) {
    yield* Effect.tryPromise({
      try: () =>
        sendMessage(
          paidFulfillmentQueueTopic,
          { orderId: input.orderId },
          {
            retentionSeconds: 24 * 60 * 60,
            idempotencyKey: `paid-fulfillment:${input.orderId}`,
          }
        ),
      catch: (cause) =>
        cause instanceof DuplicateMessageError
          ? new DuplicatePaidFulfillmentMessageError()
          : new PaidFulfillmentQueueError({
              message: "Paid fulfillment could not be enqueued.",
              cause,
            }),
    }).pipe(
      Effect.catchTag("DuplicatePaidFulfillmentMessageError", () => Effect.void)
    );
  }),
});

export class PaidFulfillmentQueueService extends Context.Service<
  PaidFulfillmentQueueService,
  IPaidFulfillmentQueueService
>()("PaidFulfillmentQueueService") {
  static Default = Layer.succeed(this, makePaidFulfillmentQueueService());
}
