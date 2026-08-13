import { DuplicateMessageError, send } from "@vercel/queue";
import { Context, Data, Effect, Layer, Option, Schema } from "effect";
import {
  type PaymentAttemptId,
  paymentAttemptIdSchema,
} from "@/features/checkout/checkout-identifiers";
import { serializeErrorForLog } from "@/shared/utils/error-formatting";
import { LatePaymentRecoveryService } from "./late-payment-recovery.service";

export const latePaymentRecoveryQueueTopic = "workspace-late-payment-recovery";

const payloadSchema = Schema.Struct({
  paymentAttemptId: paymentAttemptIdSchema,
});

export class LatePaymentRecoveryQueueError extends Data.TaggedError(
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
      catch: (cause) => cause,
    }).pipe(
      Effect.catchIf(
        (cause) => cause instanceof DuplicateMessageError,
        () => Effect.void
      ),
      Effect.mapError(
        (cause) =>
          new LatePaymentRecoveryQueueError({
            message: "Late-payment recovery could not be enqueued.",
            cause: serializeErrorForLog(cause),
          })
      )
    );
  }),
});

export class LatePaymentRecoveryQueueService extends Context.Service<
  LatePaymentRecoveryQueueService,
  ILatePaymentRecoveryQueueService
>()("LatePaymentRecoveryQueueService") {
  static Live = Layer.succeed(this, makeLatePaymentRecoveryQueueService());
}

const decodePayload = Schema.decodeUnknownOption(payloadSchema);

export const processLatePaymentRecoveryMessage = Effect.fn(
  "latePaymentRecoveryQueue.processMessage"
)(function* (message: Parameters<typeof decodePayload>[0]) {
  const payload = Option.getOrUndefined(decodePayload(message));
  if (!payload) {
    yield* Effect.logWarning(
      "Late-payment recovery queue message ignored: invalid payload"
    );
    return "ignored" as const;
  }

  const recovery = yield* LatePaymentRecoveryService;
  return yield* recovery.recover({
    paymentAttemptId: payload.paymentAttemptId,
  });
});
