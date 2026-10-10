import { Effect, Option, Schema } from "effect";
import { paymentAttemptIdSchema } from "@/features/checkout/checkout-identifiers";
import { LatePaymentRecoveryService } from "./late-payment-recovery.service";

const payloadSchema = Schema.Struct({
  paymentAttemptId: paymentAttemptIdSchema,
});

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
