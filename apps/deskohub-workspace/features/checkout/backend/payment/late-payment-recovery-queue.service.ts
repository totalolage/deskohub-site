import { DuplicateMessageError, send } from "@vercel/queue";
import { Context, Data, Effect, Layer } from "effect";
import type { PaymentAttemptId } from "@/features/checkout/checkout-identifiers";
import { serializeErrorForLog } from "@/shared/utils/error-formatting";

export const latePaymentRecoveryQueueTopic = "workspace-late-payment-recovery";

export class LatePaymentRecoveryQueueError extends Data.TaggedError(
  "LatePaymentRecoveryQueueError"
)<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

class DuplicateLatePaymentRecoveryMessageError extends Data.TaggedError(
  "DuplicateLatePaymentRecoveryMessageError"
) {}

interface ILatePaymentRecoveryQueueService {
  readonly enqueue: (input: {
    readonly paymentAttemptId: PaymentAttemptId;
  }) => Effect.Effect<void, LatePaymentRecoveryQueueError>;
}

export const makeLatePaymentRecoveryQueueService = (
  sendMessage: typeof send = send
): ILatePaymentRecoveryQueueService => ({
  enqueue: Effect.fn("latePaymentRecoveryQueue.enqueue")(function* (input) {
    yield* Effect.tryPromise({
      try: () =>
        sendMessage(
          latePaymentRecoveryQueueTopic,
          { paymentAttemptId: input.paymentAttemptId },
          {
            retentionSeconds: 7 * 24 * 60 * 60,
            idempotencyKey: `late-payment-recovery:${input.paymentAttemptId}`,
          }
        ),
      catch: (cause) =>
        cause instanceof DuplicateMessageError
          ? new DuplicateLatePaymentRecoveryMessageError()
          : new LatePaymentRecoveryQueueError({
              message: "Late-payment recovery could not be enqueued.",
              cause: serializeErrorForLog(cause),
            }),
    }).pipe(
      Effect.catchTag(
        "DuplicateLatePaymentRecoveryMessageError",
        () => Effect.void
      )
    );
  }),
});

export class LatePaymentRecoveryQueueService extends Context.Service<
  LatePaymentRecoveryQueueService,
  ILatePaymentRecoveryQueueService
>()("LatePaymentRecoveryQueueService") {
  static Default = Layer.succeed(this, makeLatePaymentRecoveryQueueService());
}
