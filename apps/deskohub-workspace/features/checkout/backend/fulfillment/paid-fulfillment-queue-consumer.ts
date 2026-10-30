import { Data, Effect, Match, Predicate, Result } from "effect";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import { QueueRedelivery } from "@/shared/backend/queue/queue-consumer";
import {
  FulfillmentLedger,
  type PaidFulfillmentProgress,
} from "./fulfillment-ledger.repository";
import { ReservationFulfillment } from "./reservation-fulfillment.service";

type PaidFulfillmentQueueProgress = Data.TaggedEnum<{
  /** No delivery of this message can change the order any more. */
  Settled: {
    readonly reason:
      | "reservation_missing"
      | "reservation_not_paid"
      | "fulfillment_settled"
      | "late_payment_recovery_settled"
      | "reservation_cancelled";
  };
  /** Fulfillment can still progress, so the message is redelivered. */
  Pending: {
    readonly reason:
      | "fulfillment_in_progress"
      | "fulfillment_failed"
      | "late_payment_recovery_in_progress"
      | "invoice_processing_failed";
  };
  /** A state no fulfillment path expects; redelivered and logged as an error. */
  Blocked: { readonly reason: "reservation_not_fulfillable" };
}>;

const PaidFulfillmentQueueProgress =
  Data.taggedEnum<PaidFulfillmentQueueProgress>();

/**
 * Mirrors the claim in `claimPaidFulfillment`: an order the claim can never
 * take again is settled for this message. The claim retakes a `failed`
 * fulfillment, so one on a held or confirmed reservation stays pending, and it
 * settles only once the reservation is cancelled. Late-payment recoveries that
 * ended in `refund_required` or `review_required` are owned by the refund batch
 * and operators, and the stalled-fulfillment cron skips them too.
 */
const describePaidFulfillmentProgress = (
  progress: PaidFulfillmentProgress | null
): PaidFulfillmentQueueProgress => {
  if (!progress) {
    return PaidFulfillmentQueueProgress.Settled({
      reason: "reservation_missing",
    });
  }
  if (progress.paymentState !== "paid") {
    return PaidFulfillmentQueueProgress.Settled({
      reason: "reservation_not_paid",
    });
  }
  if (
    progress.fulfillmentState !== "not_started" &&
    progress.fulfillmentState !== "processing" &&
    progress.fulfillmentState !== "failed"
  ) {
    return PaidFulfillmentQueueProgress.Settled({
      reason: "fulfillment_settled",
    });
  }
  if (
    progress.latePaymentRecoveryState === "refund_required" ||
    progress.latePaymentRecoveryState === "review_required"
  ) {
    return PaidFulfillmentQueueProgress.Settled({
      reason: "late_payment_recovery_settled",
    });
  }
  if (
    progress.latePaymentRecoveryState === "pending" ||
    progress.latePaymentRecoveryState === "processing"
  ) {
    return PaidFulfillmentQueueProgress.Pending({
      reason: "late_payment_recovery_in_progress",
    });
  }
  if (
    progress.reservationState === "held" ||
    progress.reservationState === "confirmed"
  ) {
    return PaidFulfillmentQueueProgress.Pending({
      reason:
        progress.fulfillmentState === "failed"
          ? "fulfillment_failed"
          : "fulfillment_in_progress",
    });
  }
  if (progress.reservationState === "cancelled") {
    return PaidFulfillmentQueueProgress.Settled({
      reason: "reservation_cancelled",
    });
  }
  return PaidFulfillmentQueueProgress.Blocked({
    reason: "reservation_not_fulfillable",
  });
};

/** Redelivers the message with backoff: fulfillment can still progress. */
class PaidFulfillmentPendingError extends Data.TaggedError(
  "PaidFulfillmentPendingError"
)<{
  readonly orderId: WorkspaceReservationId;
  readonly reason: PaidFulfillmentQueueProgress["reason"];
  readonly cause: unknown;
}> {}

/** Fulfillment failed into a settled state that no redelivery can change. */
class PaidFulfillmentSettledFailureError extends Data.TaggedError(
  "PaidFulfillmentSettledFailureError"
)<{
  readonly orderId: WorkspaceReservationId;
  readonly reason: PaidFulfillmentQueueProgress["reason"];
  readonly cause: unknown;
}> {}

export const processPaidFulfillmentMessage = Effect.fn(
  "paidFulfillmentQueue.processMessage"
)(function* ({ orderId }: { readonly orderId: WorkspaceReservationId }) {
  const fulfillment = yield* ReservationFulfillment;
  const run = yield* fulfillment.run(orderId).pipe(Effect.result);
  const failure = Result.isFailure(run) ? run.failure : undefined;

  // An invoice failure leaves the order fulfilled; only a redelivery retries
  // the invoice.
  const ledger = yield* FulfillmentLedger;
  const progress =
    Predicate.isTagged(failure, "WorkspacePaidFulfillmentError") &&
    failure.failureCode === "invoice_processing_failed"
      ? PaidFulfillmentQueueProgress.Pending({
          reason: "invoice_processing_failed",
        })
      : describePaidFulfillmentProgress(
          yield* ledger.findPaidFulfillmentProgress(orderId)
        );

  return yield* Match.value(progress).pipe(
    Match.tagsExhaustive({
      Settled: ({ reason }) =>
        failure === undefined
          ? Effect.succeed(reason)
          : Effect.fail(
              new PaidFulfillmentSettledFailureError({
                orderId,
                reason,
                cause: failure,
              })
            ),
      Pending: ({ reason }) =>
        Effect.fail(
          new PaidFulfillmentPendingError({ orderId, reason, cause: failure })
        ),
      Blocked: ({ reason }) =>
        Effect.logError(
          "Paid fulfillment queue message blocked by an unexpected reservation state",
          { orderId, reason }
        ).pipe(
          Effect.andThen(
            Effect.fail(
              new PaidFulfillmentPendingError({
                orderId,
                reason,
                cause: failure,
              })
            )
          )
        ),
    })
  );
});

/** Classifies a failed delivery; the route's Layer failures stay unclassified. */
export const paidFulfillmentRedelivery = (cause: unknown) => {
  if (cause instanceof PaidFulfillmentPendingError) {
    return QueueRedelivery.WithBackoff();
  }
  if (cause instanceof PaidFulfillmentSettledFailureError) {
    return QueueRedelivery.Never();
  }
  return QueueRedelivery.Default();
};
