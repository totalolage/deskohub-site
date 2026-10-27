import { Effect } from "effect";
import type { PaymentAttemptId } from "@/features/checkout/checkout-identifiers";
import { LatePaymentRecoveryService } from "./late-payment-recovery.service";

export const processLatePaymentRecoveryMessage = Effect.fn(
  "latePaymentRecoveryQueue.processMessage"
)(function* (message: { readonly paymentAttemptId: PaymentAttemptId }) {
  const recovery = yield* LatePaymentRecoveryService;
  return yield* recovery.recover({
    paymentAttemptId: message.paymentAttemptId,
  });
});
