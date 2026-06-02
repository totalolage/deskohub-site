import { DotyposService } from "@deskohub/dotypos";
import { Context, Data, Effect, Layer } from "effect";
import {
  PaymentOrderRepository,
} from "@/features/checkout/backend/payment-order.repository";

export class ReservationHoldCleanupError extends Data.TaggedError(
  "ReservationHoldCleanupError"
)<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export interface ReservationHoldCleanupService {
  readonly cancelOrderHold: (input: {
    readonly orderId: string;
    readonly holdExpiredAt?: Date;
  }) => Effect.Effect<void, ReservationHoldCleanupError>;
  readonly sweepExpiredHolds: (input: {
    readonly now: Date;
    readonly limit: number;
  }) => Effect.Effect<{ readonly cancelled: number; readonly failed: number }, never>;
}

export const ReservationHoldCleanupService =
  Context.GenericTag<ReservationHoldCleanupService>(
    "ReservationHoldCleanupService"
  );

const toMessage = (cause: unknown) =>
  cause instanceof Error ? cause.message : String(cause);

export const ReservationHoldCleanupServiceLive = Layer.effect(
  ReservationHoldCleanupService,
  Effect.gen(function* () {
    const paymentOrders = yield* PaymentOrderRepository;
    const dotypos = yield* DotyposService;

    const cancelOrderHold = Effect.fn("reservationHoldCleanup.cancelOrderHold")(
      function* (input: { readonly orderId: string; readonly holdExpiredAt?: Date }) {
        const claimedFromNew = yield* paymentOrders
          .claimReservationCancellation(input.orderId)
          .pipe(
            Effect.mapError(
              (cause) =>
                new ReservationHoldCleanupError({
                  message: "Reservation hold cancellation could not be claimed.",
                  cause,
                })
            )
          );

        const claimed = claimedFromNew ?? (yield* paymentOrders.findById(input.orderId).pipe(
          Effect.mapError(
            (cause) =>
              new ReservationHoldCleanupError({
                message: "Reservation hold cancellation state could not be loaded.",
                cause,
              })
          )
        ));

        if (!claimed || claimed.dotyposReservationStatus !== "cancellation_pending") return;
        if (!claimed.dotyposReservationId) return;
        if (!["created", "payment_pending"].includes(claimed.paymentStatus)) return;

        yield* dotypos.cancelReservation(claimed.dotyposReservationId).pipe(
          Effect.tapError((cause) =>
            paymentOrders.markReservationCancellationFailed({
              id: claimed.id,
              failureCode: "dotypos_cancel_failed",
              failureMessage: toMessage(cause),
            }).pipe(Effect.ignore)
          ),
          Effect.mapError(
            (cause) =>
              new ReservationHoldCleanupError({
                message: "Dotypos reservation hold could not be cancelled.",
                cause,
              })
          )
        );

        yield* paymentOrders
          .markReservationCancelled({
            id: claimed.id,
            cancelledAt: new Date(),
            holdExpiredAt: input.holdExpiredAt,
          })
          .pipe(
            Effect.mapError(
              (cause) =>
                new ReservationHoldCleanupError({
                  message: "Reservation hold cancellation marker could not be stored.",
                  cause,
                })
            )
          );
      },
      (effect, input) => effect.pipe(Effect.annotateLogs(input))
    );

    return ReservationHoldCleanupService.of({
      cancelOrderHold,
      sweepExpiredHolds: Effect.fn("reservationHoldCleanup.sweepExpiredHolds")(
        function* (input) {
          const orders = yield* paymentOrders
            .selectExpiredReservationHolds(input)
            .pipe(Effect.orElseSucceed(() => []));
          let cancelled = 0;
          let failed = 0;

          for (const order of orders) {
            const result = yield* cancelOrderHold({
              orderId: order.id,
              holdExpiredAt: input.now,
            }).pipe(Effect.either);

            if (result._tag === "Right") {
              cancelled += 1;
            } else {
              failed += 1;
              yield* Effect.logError("Expired reservation hold cleanup failed", {
                orderId: order.id,
                cause: result.left,
              });
            }
          }

          return { cancelled, failed };
        },
        (effect, input) => effect.pipe(Effect.annotateLogs(input))
      ),
    });
  })
);

export const ReservationHoldCleanupServiceLiveWithDependencies =
  ReservationHoldCleanupServiceLive;
