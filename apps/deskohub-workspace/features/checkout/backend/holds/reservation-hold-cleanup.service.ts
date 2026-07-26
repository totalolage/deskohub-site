import { randomUUID } from "node:crypto";
import { DotyposService } from "@deskohub/dotypos";
import { Context, Data, Effect, Layer, Match } from "effect";
import { WorkspaceDatabaseLive } from "@/db/database.service";
import {
  type CancellationRecoveryContext,
  type WorkspaceReservation,
  WorkspaceReservationRepository,
  WorkspaceReservationRepositoryLive,
} from "@/features/reservation/backend/workspace-reservation.repository";
import {
  PostHogEventService,
  PostHogEventServiceLive,
} from "@/shared/backend/analytics/posthog-event.service";
import { DotyposServiceLive } from "@/shared/backend/config/dotypos.config";
import { captureReservationAbandoned } from "../analytics/posthog-lifecycle-events";
import {
  ProviderPaymentFinalizationService,
  ProviderPaymentFinalizationServiceLiveWithDependencies,
} from "../payment/provider-payment-finalization.service";
import {
  PaymentAttemptRepository,
  PaymentAttemptRepositoryLive,
} from "../repositories/payment-attempt.repository";

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

export const getDotyposCancellationAction = (
  status: "NEW" | "CANCELLED" | "CONFIRMED"
) =>
  ({
    CANCELLED: "complete",
    CONFIRMED: "refuse",
    NEW: "delete",
  })[status] as "complete" | "delete" | "refuse";

export interface ReservationHoldCleanupService {
  readonly cancelOrderHold: (
    input: {
      readonly orderId: string;
    } & CancellationRecoveryContext
  ) => Effect.Effect<
    ReservationHoldCleanupOutcome,
    ReservationHoldCleanupError
  >;
  readonly sweepExpiredHolds: (input: {
    readonly now: Temporal.Instant;
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
    const paymentAttempts = yield* PaymentAttemptRepository;
    const finalization = yield* ProviderPaymentFinalizationService;
    const dotypos = yield* DotyposService;
    const posthogEvents = yield* PostHogEventService;

    const cancelOrderHold = Effect.fn("reservationHoldCleanup.cancelOrderHold")(
      function* (
        input: {
          readonly orderId: string;
        } & CancellationRecoveryContext
      ) {
        yield* Effect.annotateLogsScoped({ input });
        yield* Effect.logInfo("Reservation hold cancellation started");

        let active = yield* reservations
          .findById(input.orderId)
          .pipe(
            Effect.mapError(
              ReservationHoldCleanupError.fromError(
                "Reservation hold cancellation state could not be loaded."
              )
            )
          );
        yield* Effect.logDebug(
          "Reservation hold cancellation active reservation loaded",
          {
            reservationState: active?.reservationState,
            paymentState: active?.paymentState,
          }
        );

        if (
          active?.paymentState === "pending" &&
          (active.reservationState === "cancelling" ||
            active.reservationState === "cancellation_claimed" ||
            active.reservationState === "cancellation_failed")
        ) {
          active = yield* reservations
            .restorePendingCancellationForReconciliation(active.id)
            .pipe(
              Effect.mapError(
                ReservationHoldCleanupError.fromError(
                  "Legacy pending cancellation could not be restored for payment reconciliation."
                )
              )
            );
          if (!active) {
            yield* Effect.logInfo(
              "Reservation hold cancellation skipped: pending cancellation is still actively owned"
            );
            return "skipped";
          }
          yield* Effect.logWarning(
            "Legacy pending cancellation restored for provider reconciliation"
          );
        }

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

          const recordSkippedCleanupAttempt = () =>
            input.recoveryReason === "hold_expired"
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
            yield* recordSkippedCleanupAttempt();
            return "skipped";
          }
        }

        const ownerId = randomUUID();
        const claimRecoveryContext = getRecoveryContextFromInput(input);
        const claimed = yield* reservations
          .claimCancellation({
            id: input.orderId,
            ownerId,
            ...claimRecoveryContext,
          })
          .pipe(
            Effect.mapError(
              ReservationHoldCleanupError.fromError(
                "Reservation hold cancellation could not be claimed."
              )
            )
          );
        yield* Effect.logDebug(
          "Reservation hold cancellation claim completed",
          {
            claimed: claimed !== null,
          }
        );

        if (!claimed) {
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
        const markOwnedCancellationFailed = (
          failureCode: string,
          disposition: "retryable" | "manual_review"
        ) =>
          reservations
            .markCancellationFailed({
              id: claimed.id,
              ownerId,
              disposition,
              recoveryReason: input.recoveryReason,
              failureCode,
            })
            .pipe(
              Effect.as(true),
              Effect.catchTag("WorkspaceReservationStateError", () =>
                Effect.logWarning(
                  "Reservation cancellation failure marker skipped: ownership changed",
                  { orderId: claimed.id }
                ).pipe(Effect.as(false))
              ),
              Effect.mapError(
                ReservationHoldCleanupError.fromError(
                  "Reservation cancellation failure marker could not be stored."
                )
              )
            );

        yield* Effect.logInfo(
          "Dotypos reservation hold live status read started"
        );
        const status = yield* dotypos
          .getReservationStatus(claimed.dotyposReservationId)
          .pipe(
            Effect.tapError(() =>
              markOwnedCancellationFailed(
                "dotypos_cancellation_status_read_failed",
                "retryable"
              ).pipe(Effect.ignore)
            ),
            Effect.mapError(
              ReservationHoldCleanupError.fromError(
                "Dotypos reservation hold status could not be read."
              )
            )
          );
        const action = getDotyposCancellationAction(status);
        yield* Effect.logInfo(
          "Dotypos reservation hold live status read completed",
          { status, action }
        );

        const owned = yield* reservations
          .renewCancellationClaim({
            id: claimed.id,
            ownerId,
            recoveryReason: input.recoveryReason,
          })
          .pipe(
            Effect.mapError(
              ReservationHoldCleanupError.fromError(
                "Reservation cancellation ownership could not be reloaded."
              )
            )
          );
        if (!owned?.dotyposReservationId) {
          yield* Effect.logWarning(
            "Reservation hold cancellation skipped: ownership changed before provider action"
          );
          return "skipped";
        }

        if (action === "refuse") {
          yield* Effect.logWarning(
            "Dotypos reservation hold cancellation refused for live provider status",
            { status }
          );
          yield* markOwnedCancellationFailed(
            "dotypos_reservation_status_not_cancellable",
            "manual_review"
          );
          return "skipped";
        }

        if (action === "delete") {
          yield* Effect.logInfo(
            "Dotypos reservation hold cancellation started"
          );
          yield* dotypos.cancelReservation(owned.dotyposReservationId).pipe(
            Effect.tapError((cause) =>
              Effect.gen(function* () {
                yield* Effect.logError(
                  "Dotypos reservation hold cancellation failed",
                  { orderId: claimed.id, cause }
                );
                yield* markOwnedCancellationFailed(
                  "dotypos_cancel_failed",
                  "retryable"
                ).pipe(Effect.ignore);
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
        }

        yield* Effect.logInfo("Reservation hold cancelled marker started");
        const cancelledAt = Temporal.Now.instant();
        const completionRecoveryContext = getRecoveryContextFromInput(input);
        const markedCancelled = yield* reservations
          .markCancelled({
            id: claimed.id,
            ownerId,
            cancelledAt,
            ...completionRecoveryContext,
          })
          .pipe(
            Effect.as(true),
            Effect.catchTag("WorkspaceReservationStateError", () =>
              Effect.logWarning(
                "Reservation hold cancellation marker skipped: ownership changed",
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
          reservation: owned,
          timestamp: cancelledAt,
        }).pipe(Effect.provideService(PostHogEventService, posthogEvents));
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

          const orders = yield* reservations
            .selectCancellationCandidates(input)
            .pipe(
              Effect.tapError((cause) =>
                Effect.logError("Cancellation recovery selection failed", {
                  cause,
                })
              ),
              Effect.mapError(
                ReservationHoldCleanupError.fromError(
                  "Reservation cancellation candidates could not be selected."
                )
              )
            );
          yield* Effect.logInfo(
            "Reservation cancellation recovery selection completed",
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
              ...getCancellationRecoveryContext(order, input.now),
            }).pipe(Effect.result);

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

const getCancellationRecoveryContext = (
  reservation: WorkspaceReservation,
  now: Temporal.Instant
): CancellationRecoveryContext => {
  if (reservation.reservationState === "held") {
    return { recoveryReason: "hold_expired", holdExpiredAt: now };
  }
  if (
    reservation.reservationState === "cancelling" ||
    reservation.reservationState === "cancellation_claimed"
  ) {
    return { recoveryReason: "stale_claim_recovery" };
  }
  if (
    reservation.cancellationRecoveryReason === "hold_expired" &&
    reservation.reservationHoldExpiredAt
  ) {
    return {
      recoveryReason: "hold_expired",
      holdExpiredAt: reservation.reservationHoldExpiredAt,
    };
  }
  const recoveryReason =
    reservation.cancellationRecoveryReason ?? "retryable_failure";
  return recoveryReason === "hold_expired"
    ? { recoveryReason: "retryable_failure" }
    : { recoveryReason };
};

const getRecoveryContextFromInput = (
  input: CancellationRecoveryContext
): CancellationRecoveryContext =>
  input.recoveryReason === "hold_expired"
    ? {
        recoveryReason: "hold_expired",
        holdExpiredAt: input.holdExpiredAt,
      }
    : { recoveryReason: input.recoveryReason };

export const ReservationHoldCleanupServiceLiveWithDependencies =
  ReservationHoldCleanupServiceLive.pipe(
    Layer.provide(ProviderPaymentFinalizationServiceLiveWithDependencies),
    Layer.provide(PaymentAttemptRepositoryLive),
    Layer.provide(PostHogEventServiceLive),
    Layer.provide(WorkspaceReservationRepositoryLive),
    Layer.provide(WorkspaceDatabaseLive),
    Layer.provide(DotyposServiceLive)
  );
