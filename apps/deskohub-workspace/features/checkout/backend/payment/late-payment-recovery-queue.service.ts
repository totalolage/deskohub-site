import { Context, Data, Duration, Effect, Layer, Schema } from "effect";
import {
  type PaymentAttemptId,
  paymentAttemptIdSchema,
} from "@/features/checkout/checkout-identifiers";
import { QueuePublisher } from "@/shared/backend/queue/queue-publisher";
import { defineQueueTopic } from "@/shared/backend/queue/queue-topic";

/** One message per payment attempt: the key is the recovery's idempotency. */
export const latePaymentRecoveryTopic = defineQueueTopic({
  topic: "workspace-late-payment-recovery",
  label: "Late-payment recovery",
  message: Schema.toStandardSchemaV1(
    Schema.Struct({ paymentAttemptId: paymentAttemptIdSchema })
  ),
  publish: (input: { readonly paymentAttemptId: PaymentAttemptId }) => ({
    message: { paymentAttemptId: input.paymentAttemptId },
    key: `late-payment-recovery:${input.paymentAttemptId}`,
  }),
  retention: Duration.days(7),
});

class LatePaymentRecoveryQueueError extends Data.TaggedError(
  "LatePaymentRecoveryQueueError"
)<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

interface ILatePaymentRecoveryQueueService {
  readonly enqueue: (input: {
    readonly paymentAttemptId: PaymentAttemptId;
  }) => Effect.Effect<void, LatePaymentRecoveryQueueError>;
}

export class LatePaymentRecoveryQueueService extends Context.Service<
  LatePaymentRecoveryQueueService,
  ILatePaymentRecoveryQueueService
>()("LatePaymentRecoveryQueueService") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const publisher = yield* QueuePublisher;
      return {
        enqueue: Effect.fn("latePaymentRecoveryQueue.enqueue")(
          function* (input) {
            yield* latePaymentRecoveryTopic.publish(input).pipe(
              Effect.provideService(QueuePublisher, publisher),
              Effect.mapError(
                (error) =>
                  new LatePaymentRecoveryQueueError({
                    message: "Late-payment recovery could not be enqueued.",
                    cause: error.cause,
                  })
              )
            );
          }
        ),
      };
    })
  );

  static Live = this.Default.pipe(Layer.provide(QueuePublisher.Default));
}
