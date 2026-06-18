import { DotyposService } from "@deskohub/dotypos";
import { Context, Data, Effect, Layer } from "effect";
import { OperationalEventRepository } from "@/features/checkout/backend/operational-event.repository";
import { captureReservationAbandoned } from "@/features/checkout/backend/posthog-lifecycle-events";
import {
  ProviderPaymentFinalizationService,
  ProviderPaymentFinalizationServiceLiveWithDependencies,
} from "@/features/checkout/backend/provider-payment-finalization.service";
import { WorkspaceReservationRepository } from "@/features/reservation/backend/workspace-reservation.repository";
import {
  PostHogEventService,
  PostHogEventServiceLive,
} from "@/shared/backend/analytics/posthog-event.service";

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
    const posthogEvents = yield* PostHogEventService;

    const cancelOrderHold = Effect.fn("reservationHoldCleanup.cancelOrderHold")(
      function* (input: {
        readonly orderId: string;
        readonly holdExpiredAt?: Date;
      }) {
        yield* Effect.annotateLogsScoped({ input });
        yield* Effect.logInfo("Reservation hold cancellation started");

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
        yield* Effect.annotateLogsScoped({ activeReservation: active });
        yield* Effect.logDebug(
          "Reservation hold cancellation active reservation loaded"
        );

        if (
          active?.reservationState === "held" &&
          active.paymentState === "pending" &&
          active.activePaymentAttemptId
        ) {
          yield* Effect.logInfo(
            "Reservation hold cancellation provider finalization started"
          );
          const result = yield* finalization.finalizePendingProviderPayment({
            orderId: active.id,
            paymentAttemptId: active.activePaymentAttemptId,
          });
          yield* Effect.annotateLogsScoped({
            providerFinalizationResult: result,
          });
          yield* Effect.logInfo(
            "Reservation hold cancellation provider finalization completed"
          );

          if (result === "paid") {
            yield* Effect.logWarning(
              "Reservation hold cancellation skipped: provider finalized paid"
            );
            return;
          }
          if (result !== "terminal") {
            yield* Effect.logWarning(
              "Reservation hold cancellation skipped: payment outcome unconfirmed"
            );
            yield* operationalEvents
              .record({
                workspaceReservationId: active.id,
                paymentAttemptId: active.activePaymentAttemptId,
                eventType:
                  "workspace_payment_outcome_unconfirmed_before_cleanup",
                severity: "warning",
              })
              .pipe(
                Effect.tapError((cause) =>
                  Effect.logWarning(
                    "Payment outcome unconfirmed cleanup event recording failed",
                    {
                      orderId: active.id,
                      paymentAttemptId: active.activePaymentAttemptId,
                      cause,
                    }
                  )
                ),
                Effect.ignore
              );
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
        yield* Effect.annotateLogsScoped({ claimedFromNew });
        yield* Effect.logDebug("Reservation hold cancellation claim completed");

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
        yield* Effect.annotateLogsScoped({ claimed });

        if (!claimed || claimed.reservationState !== "cancelling") {
          yield* Effect.logWarning(
            "Reservation hold cancellation skipped: claim not cancellable"
          );
          return;
        }
        if (!claimed.dotyposReservationId) {
          yield* Effect.logWarning(
            "Reservation hold cancellation skipped: missing Dotypos reservation"
          );
          return;
        }
        if (claimed.paymentState === "paid") {
          yield* Effect.logWarning(
            "Reservation hold cancellation skipped: reservation paid"
          );
          return;
        }

        yield* Effect.logInfo("Dotypos reservation hold cancellation started");
        yield* dotypos.cancelReservation(claimed.dotyposReservationId).pipe(
          Effect.tapError((cause) =>
            Effect.gen(function* () {
              yield* Effect.logError(
                "Dotypos reservation hold cancellation failed",
                { claimed, cause }
              );
              yield* reservations
                .markCancellationFailed({
                  id: claimed.id,
                  failureCode: "dotypos_cancel_failed",
                })
                .pipe(
                  Effect.tapError((markerCause) =>
                    Effect.logError(
                      "Reservation cancellation failure marker failed",
                      {
                        orderId: claimed.id,
                        cause: markerCause,
                      }
                    )
                  ),
                  Effect.ignore
                );
            })
          ),
          Effect.mapError(
            (cause) =>
              new ReservationHoldCleanupError({
                message: "Dotypos reservation hold could not be cancelled.",
                cause,
              })
          )
        );
        yield* Effect.logInfo(
          "Dotypos reservation hold cancellation completed"
        );

        yield* Effect.logInfo("Reservation hold cancelled marker started");
        const cancelledAt = new Date();
        yield* reservations
          .markCancelled({
            id: claimed.id,
            cancelledAt,
            holdExpiredAt: input.holdExpiredAt,
          })
          .pipe(
            Effect.catchTag("WorkspaceReservationStateError", () =>
              Effect.logWarning(
                "Reservation hold cancellation marker skipped: reservation state changed",
                { orderId: claimed.id }
              )
            ),
            Effect.mapError(
              (cause) =>
                new ReservationHoldCleanupError({
                  message:
                    "Reservation hold cancellation marker could not be stored.",
                  cause,
                })
            )
          );
        yield* Effect.logInfo("Reservation hold marked cancelled");
        yield* captureReservationAbandoned({
          reservation: claimed,
          timestamp: cancelledAt,
        }).pipe(Effect.provideService(PostHogEventService, posthogEvents));

        yield* Effect.logInfo(
          "Reservation hold cancellation event recording started"
        );
        yield* operationalEvents
          .record({
            workspaceReservationId: claimed.id,
            eventType: "workspace_reservation_hold_cancelled",
            severity: "info",
            dotyposReservationId: claimed.dotyposReservationId,
            dotyposCustomerId: claimed.dotyposCustomerId,
          })
          .pipe(
            Effect.tapError((cause) =>
              Effect.logWarning(
                "Reservation hold cancelled event recording failed",
                {
                  orderId: claimed.id,
                  cause,
                }
              )
            ),
            Effect.ignore
          );
        yield* Effect.logInfo("Reservation hold cancellation event recorded");
      },
      (effect, input) => effect.pipe(Effect.scoped, Effect.annotateLogs(input))
    );

    return ReservationHoldCleanupService.of({
      cancelOrderHold,
      sweepExpiredHolds: Effect.fn("reservationHoldCleanup.sweepExpiredHolds")(
        function* (input) {
          yield* Effect.annotateLogsScoped({ input });
          yield* Effect.logInfo("Expired reservation hold sweep started");

          const orders = yield* reservations.selectExpiredHolds(input).pipe(
            Effect.tapError((cause) =>
              Effect.logError("Expired reservation hold selection failed", {
                cause,
              })
            ),
            Effect.orElseSucceed(() => [])
          );
          yield* Effect.annotateLogsScoped({ orders });
          yield* Effect.logInfo(
            "Expired reservation hold sweep selection completed",
            {
              count: orders.length,
            }
          );
          let cancelled = 0;
          let failed = 0;

          for (const order of orders) {
            yield* Effect.logInfo("Expired reservation hold cleanup started", {
              orderId: order.id,
            });
            const result = yield* cancelOrderHold({
              orderId: order.id,
              holdExpiredAt: input.now,
            }).pipe(Effect.either);
            yield* Effect.annotateLogsScoped({ order, result });

            if (result._tag === "Right") {
              cancelled += 1;
              yield* Effect.logInfo(
                "Expired reservation hold cleanup completed",
                {
                  orderId: order.id,
                  result: "cancelled",
                }
              );
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

          const summary = { cancelled, failed };
          yield* Effect.logInfo(
            "Expired reservation hold sweep completed",
            summary
          );
          return summary;
        },
        (effect, input) =>
          effect.pipe(Effect.scoped, Effect.annotateLogs(input))
      ),
    });
  })
);

export const ReservationHoldCleanupServiceLiveWithDependencies =
  ReservationHoldCleanupServiceLive.pipe(
    Layer.provide(ProviderPaymentFinalizationServiceLiveWithDependencies),
    Layer.provide(PostHogEventServiceLive)
  );
