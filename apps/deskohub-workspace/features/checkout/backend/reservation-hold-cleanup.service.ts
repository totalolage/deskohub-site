import { DotyposService } from "@deskohub/dotypos";
import { Context, Data, Effect, Layer } from "effect";
import { OperationalEventRepository } from "@/features/checkout/backend/operational-event.repository";
import {
  ProviderPaymentFinalizationService,
  ProviderPaymentFinalizationServiceLiveWithDependencies,
} from "@/features/checkout/backend/provider-payment-finalization.service";
import {
  WorkspaceReservationRepository,
  WorkspaceReservationStateError,
} from "@/features/checkout/backend/workspace-reservation.repository";

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
  }) => Effect.Effect<
    { readonly cancelled: number; readonly failed: number },
    never
  >;
}

export const ReservationHoldCleanupService =
  Context.GenericTag<ReservationHoldCleanupService>(
    "ReservationHoldCleanupService"
  );

export const ReservationHoldCleanupServiceLive = Layer.effect(
  ReservationHoldCleanupService,
  Effect.gen(function* () {
    const reservations = yield* WorkspaceReservationRepository;
    const operationalEvents = yield* OperationalEventRepository;
    const finalization = yield* ProviderPaymentFinalizationService;
    const dotypos = yield* DotyposService;

    const cancelOrderHold = Effect.fn("reservationHoldCleanup.cancelOrderHold")(
      function* (input: {
        readonly orderId: string;
        readonly holdExpiredAt?: Date;
      }) {
        const active = yield* reservations.findById(input.orderId).pipe(
          Effect.mapError(
            (cause) =>
              new ReservationHoldCleanupError({
                message:
                  "Reservation hold cancellation state could not be loaded.",
                cause,
              })
          )
        );

        if (
          active?.reservationState === "held" &&
          active.paymentState === "pending" &&
          active.activePaymentAttemptId
        ) {
          const result = yield* finalization.finalizePendingProviderPayment({
            orderId: active.id,
            paymentAttemptId: active.activePaymentAttemptId,
          });

          if (result === "paid") return;
          if (result !== "terminal") {
            yield* operationalEvents
              .record({
                workspaceReservationId: active.id,
                paymentAttemptId: active.activePaymentAttemptId,
                eventType: "workspace_payment_outcome_unconfirmed_before_cleanup",
                severity: "warning",
              })
              .pipe(Effect.ignore);
            return;
          }
        }

        const claimedFromNew = yield* reservations
          .claimCancellation(input.orderId)
          .pipe(
            Effect.mapError(
              (cause) =>
                new ReservationHoldCleanupError({
                  message:
                    "Reservation hold cancellation could not be claimed.",
                  cause,
                })
            )
          );

        const claimed =
          claimedFromNew ??
          (yield* reservations.findById(input.orderId).pipe(
            Effect.mapError(
              (cause) =>
                new ReservationHoldCleanupError({
                  message:
                    "Reservation hold cancellation state could not be loaded.",
                  cause,
                })
            )
          ));

        if (!claimed || claimed.reservationState !== "cancelling") return;
        if (!claimed.dotyposReservationId) return;
        if (claimed.paymentState === "paid") return;

        yield* dotypos.cancelReservation(claimed.dotyposReservationId).pipe(
          Effect.tapError((_cause) =>
            reservations
              .markCancellationFailed({
                id: claimed.id,
                failureCode: "dotypos_cancel_failed",
              })
              .pipe(Effect.ignore)
          ),
          Effect.mapError(
            (cause) =>
              new ReservationHoldCleanupError({
                message: "Dotypos reservation hold could not be cancelled.",
                cause,
              })
          )
        );

        const markCancelledResult = yield* reservations
          .markCancelled({
            id: claimed.id,
            cancelledAt: new Date(),
            holdExpiredAt: input.holdExpiredAt,
          })
          .pipe(Effect.either);

        if (markCancelledResult._tag === "Left") {
          if (
            markCancelledResult.left instanceof WorkspaceReservationStateError
          ) {
            return;
          }
          return yield* Effect.fail(
            new ReservationHoldCleanupError({
              message:
                "Reservation hold cancellation marker could not be stored.",
              cause: markCancelledResult.left,
            })
          );
        }
        yield* operationalEvents
          .record({
            workspaceReservationId: claimed.id,
            eventType: "workspace_reservation_hold_cancelled",
            severity: "info",
            dotyposReservationId: claimed.dotyposReservationId,
            dotyposCustomerId: claimed.dotyposCustomerId,
          })
          .pipe(Effect.ignore);
      },
      (effect, input) => effect.pipe(Effect.annotateLogs(input))
    );

    return ReservationHoldCleanupService.of({
      cancelOrderHold,
      sweepExpiredHolds: Effect.fn("reservationHoldCleanup.sweepExpiredHolds")(
        function* (input) {
          const orders = yield* reservations
            .selectExpiredHolds(input)
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
              yield* Effect.logError(
                "Expired reservation hold cleanup failed",
                {
                  orderId: order.id,
                  cause: result.left,
                }
              );
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
  ReservationHoldCleanupServiceLive.pipe(
    Layer.provide(ProviderPaymentFinalizationServiceLiveWithDependencies)
  );
