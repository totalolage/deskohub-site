import type { DotyposWriteFailure } from "@deskohub/dotypos";
import { Context, Data, Effect, Layer, Match, Predicate } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import type { PaymentAttemptId } from "@/features/checkout/checkout-identifiers";
import {
  reservationLogFields,
  type WorkspaceReservation,
  WorkspaceReservationRepository,
} from "@/features/reservation/backend/workspace-reservation.repository";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import { WorkspaceDotyposLayer } from "@/shared/backend/config/dotypos.config";
import { CheckoutAnalytics } from "../analytics/checkout-analytics.service";
import {
  ProviderPaymentDeferral,
  ProviderPaymentFinalizationService,
} from "../payment/provider-payment-finalization.service";
import { PaymentLifecycleRepository } from "../repositories/payment-lifecycle.repository";
import { UnpaidHoldRelease } from "./unpaid-hold-release.service";

class ReservationHoldCleanupError extends Data.TaggedError(
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

/** A held order's pending provider payment must be settled before its hold goes. */
const pendingProviderPayment = (active: WorkspaceReservation | null) =>
  active?.reservationState === "held" &&
  active.paymentState === "pending" &&
  active.activePaymentAttemptId
    ? { orderId: active.id, paymentAttemptId: active.activePaymentAttemptId }
    : null;

export type ReservationHoldCleanupOutcome =
  | "cancelled"
  | ProviderPaymentDeferral
  | "skipped";

export interface IReservationHoldCleanupService {
  readonly cancelOrderHold: (input: {
    readonly orderId: WorkspaceReservationId;
    readonly checkedAt?: Temporal.Instant;
  }) => Effect.Effect<
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

export class ReservationHoldCleanupService extends Context.Service<
  ReservationHoldCleanupService,
  IReservationHoldCleanupService
>()("ReservationHoldCleanupService") {
  static Default = makeReservationHoldCleanupServiceLayer(this);

  static Live = this.Default.pipe(
    Layer.provide(UnpaidHoldRelease.Default),
    Layer.provide(ProviderPaymentFinalizationService.Live),
    Layer.provide(PaymentLifecycleRepository.Default),
    Layer.provide(CheckoutAnalytics.Live),
    Layer.provide(WorkspaceReservationRepository.Default),
    Layer.provide(WorkspaceDatabase.Default),
    Layer.provide(WorkspaceDotyposLayer)
  );
}

function makeReservationHoldCleanupServiceLayer(
  service: typeof ReservationHoldCleanupService
) {
  return Layer.effect(
    service,
    Effect.gen(function* () {
      const reservations = yield* WorkspaceReservationRepository;
      const paymentLifecycle = yield* PaymentLifecycleRepository;
      const finalization = yield* ProviderPaymentFinalizationService;
      const holdRelease = yield* UnpaidHoldRelease;
      const checkoutAnalytics = yield* CheckoutAnalytics;

      const loadOrder = (orderId: WorkspaceReservationId) =>
        reservations
          .findById(orderId)
          .pipe(
            Effect.mapError(
              ReservationHoldCleanupError.fromError(
                "Reservation hold cancellation state could not be loaded."
              )
            )
          );

      const recordSkippedCleanupAttempt = (input: {
        readonly orderId: WorkspaceReservationId;
        readonly checkedAt?: Temporal.Instant;
      }) =>
        input.checkedAt
          ? reservations
              .recordHoldCleanupSkipped({
                id: input.orderId,
                holdExpiredAt: input.checkedAt,
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

      // Expires an attempt the provider verified abandoned; a skip when the
      // attempt changed state meanwhile, nothing when the hold can go.
      const expireAbandonedPaymentAttempt = Effect.fnUntraced(
        function* (input: {
          readonly orderId: WorkspaceReservationId;
          readonly checkedAt?: Temporal.Instant;
          readonly paymentAttemptId: PaymentAttemptId;
        }) {
          const { orderId, paymentAttemptId } = input;
          yield* Effect.logInfo(
            "Reservation hold cancellation expiring payment attempt",
            { reason: "abandoned" }
          );
          const expired = yield* paymentLifecycle
            .markTerminal({
              id: paymentAttemptId,
              workspaceReservationId: orderId,
              state: "expired",
              failureCode: "payment_abandoned_after_provider_cutoff",
            })
            .pipe(
              Effect.tapError((cause) =>
                Effect.logWarning(
                  "Reservation hold cancellation payment attempt expiration failed",
                  {
                    orderId,
                    paymentAttemptId,
                    cause,
                  }
                )
              ),
              Effect.catchTag("PaymentLifecycleStateError", () =>
                Effect.succeed(undefined)
              ),
              Effect.mapError(
                ReservationHoldCleanupError.fromError(
                  "Payment attempt expiration failed during hold cleanup."
                )
              )
            );
          if (!expired) {
            yield* Effect.logWarning(
              "Reservation hold cancellation skipped: payment attempt state changed"
            );
            yield* recordSkippedCleanupAttempt(input);
            return "skipped" as const;
          }
          yield* Effect.annotateLogsScoped({
            paymentAttemptExpirationChanged: expired.changed,
          });
          yield* Effect.logInfo(
            "Reservation hold cancellation expired payment attempt",
            { reason: "abandoned" }
          );
          return undefined;
        }
      );

      // Settles a held order's pending provider payment first: the cleanup
      // outcome when the payment keeps the hold, nothing when it can go.
      const settlePendingProviderPayment = Effect.fnUntraced(function* (input: {
        readonly orderId: WorkspaceReservationId;
        readonly checkedAt?: Temporal.Instant;
        readonly paymentAttemptId: PaymentAttemptId;
      }) {
        yield* Effect.logInfo(
          "Reservation hold cancellation provider finalization started"
        );
        const result = yield* finalization
          .finalizePendingProviderPayment({
            orderId: input.orderId,
            paymentAttemptId: input.paymentAttemptId,
            ...(input.checkedAt && {
              abandonmentCheckedAt: input.checkedAt,
            }),
          })
          .pipe(
            Effect.mapError(
              ReservationHoldCleanupError.fromError(
                "Payment lifecycle finalization failed during hold cleanup."
              )
            )
          );
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
          return "skipped" as const;
        }
        if (result instanceof ProviderPaymentDeferral) {
          yield* Effect.logInfo(
            "Reservation hold cancellation deferred: empty provider order is inside abandonment window",
            { abandonmentCutoff: result.abandonmentCutoff }
          );
          return result;
        }
        if (result === "abandoned") {
          return yield* expireAbandonedPaymentAttempt(input);
        }
        if (result !== "terminal") {
          yield* Effect.logWarning(
            "Reservation hold cancellation skipped: payment outcome unconfirmed"
          );
          yield* recordSkippedCleanupAttempt(input);
          return "skipped" as const;
        }
        return undefined;
      });

      const dotyposReleaseFailed = (cause: DotyposWriteFailure) =>
        Effect.logError("Dotypos reservation hold cancellation failed", {
          cause,
        }).pipe(
          Effect.andThen(
            Effect.fail(
              new ReservationHoldCleanupError({
                message: "Dotypos reservation hold could not be cancelled.",
                cause,
              })
            )
          )
        );

      // Hold cleanup releases whatever it claims without the live Dotypos
      // NEW check that supersession and late payment apply.
      const releaseExpiredHold = Effect.fnUntraced(function* (input: {
        readonly orderId: WorkspaceReservationId;
        readonly checkedAt?: Temporal.Instant;
      }) {
        const outcome = yield* holdRelease
          .release({
            reason: "hold_expired",
            reservationId: input.orderId,
            holdExpiredAt: input.checkedAt,
          })
          .pipe(
            Effect.catchTags({
              DotyposUnavailable: dotyposReleaseFailed,
              DotyposRejected: dotyposReleaseFailed,
              DotyposUncertain: dotyposReleaseFailed,
            }),
            Effect.mapError((cause) =>
              cause instanceof ReservationHoldCleanupError
                ? cause
                : new ReservationHoldCleanupError({
                    message: "Reservation hold could not be released.",
                    cause,
                  })
            )
          );
        if (outcome === "state_changed") {
          yield* Effect.logWarning(
            "Reservation hold cancellation marker skipped: reservation state changed",
            { orderId: input.orderId }
          );
        }
        if (Predicate.isString(outcome) || !("released" in outcome)) {
          return "skipped" as const;
        }
        yield* Effect.logInfo("Reservation hold marked cancelled");
        yield* checkoutAnalytics.reservationAbandoned({
          reservation: outcome.released,
          timestamp: outcome.cancelledAt,
        });
        return "cancelled" as const;
      });

      const cancelOrderHold = Effect.fn(
        "reservationHoldCleanup.cancelOrderHold"
      )(
        function* (input: {
          readonly orderId: WorkspaceReservationId;
          readonly checkedAt?: Temporal.Instant;
        }) {
          yield* Effect.annotateLogsScoped({ input });
          yield* Effect.logInfo("Reservation hold cancellation started");

          const active = yield* loadOrder(input.orderId);
          yield* Effect.annotateLogsScoped(reservationLogFields(active));
          yield* Effect.logDebug(
            "Reservation hold cancellation active reservation loaded"
          );

          const pendingPayment = pendingProviderPayment(active);
          if (pendingPayment) {
            const settled = yield* settlePendingProviderPayment({
              ...pendingPayment,
              checkedAt: input.checkedAt,
            });
            if (settled) {
              return settled;
            }
          }

          return yield* releaseExpiredHold(input);
        },
        (effect, input) =>
          effect.pipe(Effect.scoped, Effect.annotateLogs(input))
      );

      return ReservationHoldCleanupService.of({
        cancelOrderHold,
        sweepExpiredHolds: Effect.fn(
          "reservationHoldCleanup.sweepExpiredHolds"
        )(
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
            yield* Effect.annotateLogsScoped({ orderCount: orders.length });
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
              yield* Effect.logInfo(
                "Expired reservation hold cleanup started",
                {
                  orderId: order.id,
                }
              );
              const result = yield* cancelOrderHold({
                orderId: order.id,
                checkedAt: input.now,
              }).pipe(Effect.result);
              yield* Match.value(result).pipe(
                Match.tag(
                  "Success",
                  Effect.fn(function* ({ success }) {
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
                Match.tag(
                  "Failure",
                  Effect.fn(function* ({ failure }) {
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
}
