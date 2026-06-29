import { DotyposService } from "@deskohub/dotypos";
import { Context, Data, Effect, Layer, Match } from "effect";
import { WorkspaceDatabaseLive } from "@/db/database.service";
import {
  OperationalEventRepository,
  OperationalEventRepositoryLive,
} from "@/features/checkout/backend/operational-event.repository";
import {
  PaymentAttemptRepository,
  PaymentAttemptRepositoryLive,
} from "@/features/checkout/backend/payment-attempt.repository";
import { captureReservationAbandoned } from "@/features/checkout/backend/posthog-lifecycle-events";
import {
  ProviderPaymentFinalizationService,
  ProviderPaymentFinalizationServiceLiveWithDependencies,
} from "@/features/checkout/backend/provider-payment-finalization.service";
import {
  WorkspaceReservationRepository,
  WorkspaceReservationRepositoryLive,
} from "@/features/reservation/backend/workspace-reservation.repository";
import {
  PostHogEventService,
  PostHogEventServiceLive,
} from "@/shared/backend/analytics/posthog-event.service";
import { DotyposServiceLive } from "@/shared/backend/config/dotypos.config";

export class ReservationHoldCleanupError extends Data.TaggedError(
  "ReservationHoldCleanupError"
)<{
  readonly message: string;
  readonly cause?: unknown;
}> {
  static fromError(message: string) {
    return (cause: unknown) =>
      new ReservationHoldCleanupError({ message, cause });
  }
}

export type ReservationHoldCleanupOutcome = "cancelled" | "skipped";

export interface ReservationHoldCleanupService {
  readonly cancelOrderHold: (input: {
    readonly orderId: string;
    readonly holdExpiredAt?: Date;
  }) => Effect.Effect<
    ReservationHoldCleanupOutcome,
    ReservationHoldCleanupError
  >;
  readonly sweepExpiredHolds: (input: {
    readonly now: Date;
    readonly limit: number;
  }) => Effect.Effect<
    {
      readonly cancelled: number;
      readonly skipped: number;
      readonly failed: number;
    },
    ReservationHoldCleanupError
  >;
}

export const ReservationHoldCleanupService =
  Context.Service<ReservationHoldCleanupService>(
    "ReservationHoldCleanupService"
  );

export const ReservationHoldCleanupServiceLive = Layer.effect(
  ReservationHoldCleanupService,
  Effect.gen(function* () {
    const reservations = yield* WorkspaceReservationRepository;
    const operationalEvents = yield* OperationalEventRepository;
    const paymentAttempts = yield* PaymentAttemptRepository;
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

        const active = yield* reservations
          .findById(input.orderId)
          .pipe(
            Effect.mapError(
              ReservationHoldCleanupError.fromError(
                "Reservation hold cancellation state could not be loaded."
              )
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
          const paymentAttemptId = active.activePaymentAttemptId;
          yield* Effect.logInfo(
            "Reservation hold cancellation provider finalization started"
          );
          const result = yield* finalization.finalizePendingProviderPayment({
            orderId: active.id,
            paymentAttemptId,
          });
          yield* Effect.annotateLogsScoped({
            providerFinalizationResult: result,
          });
          yield* Effect.logInfo(
            "Reservation hold cancellation provider finalization completed"
          );

          const recordUnconfirmedPaymentOutcome = () =>
            operationalEvents
              .record({
                workspaceReservationId: active.id,
                paymentAttemptId,
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
                      paymentAttemptId,
                      cause,
                    }
                  )
                ),
                Effect.ignore
              );

          const recordSkippedCleanupAttempt = () =>
            input.holdExpiredAt
              ? reservations
                  .recordHoldCleanupSkipped({
                    id: active.id,
                    holdExpiredAt: input.holdExpiredAt,
                    failureCode: "payment_outcome_unconfirmed_before_cleanup",
                  })
                  .pipe(
                    Effect.mapError(
                      ReservationHoldCleanupError.fromError(
                        "Skipped reservation hold cleanup marker could not be stored."
                      )
                    )
                  )
              : Effect.void;

          if (result === "paid") {
            yield* Effect.logWarning(
              "Reservation hold cancellation skipped: provider finalized paid"
            );
            return "skipped";
          }
          if (result === "not_verifiable") {
            yield* Effect.logInfo(
              "Reservation hold cancellation expiring not-verifiable payment attempt"
            );
            const expired = yield* paymentAttempts
              .markTerminalForReservation({
                id: paymentAttemptId,
                workspaceReservationId: active.id,
                state: "expired",
                failureCode: "payment_not_verifiable_before_cleanup",
              })
              .pipe(
                Effect.tapError((cause) =>
                  Effect.logWarning(
                    "Reservation hold cancellation payment attempt expiration failed",
                    {
                      orderId: active.id,
                      paymentAttemptId,
                      cause,
                    }
                  )
                ),
                Effect.result
              );
            if (expired._tag === "Failure") {
              yield* Effect.logWarning(
                "Reservation hold cancellation skipped: payment attempt expiration failed"
              );
              yield* recordUnconfirmedPaymentOutcome();
              yield* recordSkippedCleanupAttempt();
              return "skipped";
            }
            yield* Effect.annotateLogsScoped({
              paymentAttemptExpirationChanged: expired.success.changed,
            });
            yield* Effect.logInfo(
              "Reservation hold cancellation expired not-verifiable payment attempt"
            );
          } else if (result !== "terminal") {
            yield* Effect.logWarning(
              "Reservation hold cancellation skipped: payment outcome unconfirmed"
            );
            yield* recordUnconfirmedPaymentOutcome();
            yield* recordSkippedCleanupAttempt();
            return "skipped";
          }
        }

        const claimedFromNew = yield* reservations
          .claimCancellation(input.orderId)
          .pipe(
            Effect.mapError(
              ReservationHoldCleanupError.fromError(
                "Reservation hold cancellation could not be claimed."
              )
            )
          );
        yield* Effect.annotateLogsScoped({ claimedFromNew });
        yield* Effect.logDebug("Reservation hold cancellation claim completed");

        const claimed =
          claimedFromNew ??
          (yield* reservations
            .findById(input.orderId)
            .pipe(
              Effect.mapError(
                ReservationHoldCleanupError.fromError(
                  "Reservation hold cancellation state could not be loaded."
                )
              )
            ));
        yield* Effect.annotateLogsScoped({ claimed });

        if (!claimed || claimed.reservationState !== "cancelling") {
          yield* Effect.logWarning(
            "Reservation hold cancellation skipped: claim not cancellable"
          );
          return "skipped";
        }
        if (!claimed.dotyposReservationId) {
          yield* Effect.logWarning(
            "Reservation hold cancellation skipped: missing Dotypos reservation"
          );
          return "skipped";
        }
        if (claimed.paymentState === "paid") {
          yield* Effect.logWarning(
            "Reservation hold cancellation skipped: reservation paid"
          );
          return "skipped";
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
            ReservationHoldCleanupError.fromError(
              "Dotypos reservation hold could not be cancelled."
            )
          )
        );
        yield* Effect.logInfo(
          "Dotypos reservation hold cancellation completed"
        );

        yield* Effect.logInfo("Reservation hold cancelled marker started");
        const cancelledAt = new Date();
        const markedCancelled = yield* reservations
          .markCancelled({
            id: claimed.id,
            cancelledAt,
            holdExpiredAt: input.holdExpiredAt,
          })
          .pipe(
            Effect.as(true),
            Effect.catchTag("WorkspaceReservationStateError", () =>
              Effect.logWarning(
                "Reservation hold cancellation marker skipped: reservation state changed",
                { orderId: claimed.id }
              ).pipe(Effect.as(false))
            ),
            Effect.mapError(
              ReservationHoldCleanupError.fromError(
                "Reservation hold cancellation marker could not be stored."
              )
            )
          );
        if (!markedCancelled) return "skipped";
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
        return "cancelled";
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
            Effect.mapError(
              ReservationHoldCleanupError.fromError(
                "Expired reservation holds could not be selected."
              )
            )
          );
          yield* Effect.annotateLogsScoped({ orders });
          yield* Effect.logInfo(
            "Expired reservation hold sweep selection completed",
            {
              count: orders.length,
            }
          );
          let cancelled = 0;
          let skipped = 0;
          let failed = 0;

          for (const order of orders) {
            yield* Effect.logInfo("Expired reservation hold cleanup started", {
              orderId: order.id,
            });
            const result = yield* cancelOrderHold({
              orderId: order.id,
              holdExpiredAt: input.now,
            }).pipe(Effect.result);
            yield* Effect.annotateLogsScoped({ order, result });

            yield* Match.value(result).pipe(
              Match.tag("Success", ({ success }) =>
                Effect.gen(function* () {
                  if (success === "cancelled") cancelled += 1;
                  else skipped += 1;
                  yield* Effect.logInfo(
                    "Expired reservation hold cleanup completed",
                    {
                      orderId: order.id,
                      result: success,
                    }
                  );
                })
              ),
              Match.tag("Failure", ({ failure }) =>
                Effect.gen(function* () {
                  failed += 1;
                  yield* Effect.logError(
                    "Expired reservation hold cleanup failed",
                    {
                      orderId: order.id,
                      cause: failure,
                    }
                  );
                })
              ),
              Match.exhaustive
            );
          }

          const summary = { cancelled, skipped, failed };
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
    Layer.provide(OperationalEventRepositoryLive),
    Layer.provide(PaymentAttemptRepositoryLive),
    Layer.provide(PostHogEventServiceLive),
    Layer.provide(WorkspaceReservationRepositoryLive),
    Layer.provide(WorkspaceDatabaseLive),
    Layer.provide(DotyposServiceLive)
  );
