import {
  classifyNexiFailureStatus,
  getNexiPaymentMetadata,
  NexiCurrencySchema,
  NexiService,
} from "@deskohub/nexi";
import { Context, Effect, Layer, Schema } from "effect";
import { WorkspaceDatabaseLive } from "@/db/database.service";
import {
  WorkspaceReservationRepository,
  WorkspaceReservationRepositoryLive,
} from "@/features/reservation/backend/workspace-reservation.repository";
import {
  PostHogEventService,
  PostHogEventServiceLive,
} from "@/shared/backend/analytics/posthog-event.service";
import { NexiServiceLive } from "@/shared/backend/config/nexi.config";
import {
  capturePaymentAbandoned,
  capturePaymentCompleted,
  capturePaymentFailed,
} from "../analytics/posthog-lifecycle-events";
import {
  WorkspacePaidFulfillmentService,
  WorkspacePaidFulfillmentServiceLiveWithDependencies,
} from "../fulfillment/paid-fulfillment.service";
import {
  PaymentAttemptRepository,
  PaymentAttemptRepositoryLive,
} from "../repositories/payment-attempt.repository";
import {
  PaymentLifecycleRepository,
  type PaymentLifecycleRepositoryError,
} from "../repositories/payment-lifecycle.repository";
import { getNexiCurrencyOverride } from "./nexi-currency";
import { getProviderEvidenceConflictCodes } from "./provider-evidence-conflict";

export type ProviderPaymentFinalizationResult =
  | "not_found"
  | "not_pending"
  | "not_verifiable"
  | "provider_verification_failed"
  | "verification_mismatch"
  | "manual_review"
  | "pending"
  | "paid"
  | "terminal";

export interface ProviderPaymentFinalizationService {
  readonly finalizePendingProviderPayment: (input: {
    readonly orderId: string;
    readonly paymentAttemptId?: string;
    readonly webhookEventId?: string;
  }) => Effect.Effect<
    ProviderPaymentFinalizationResult,
    PaymentLifecycleRepositoryError
  >;
}

export const ProviderPaymentFinalizationService =
  Context.Service<ProviderPaymentFinalizationService>(
    "ProviderPaymentFinalizationService"
  );

export const ProviderPaymentFinalizationServiceLive = Layer.effect(
  ProviderPaymentFinalizationService,
  Effect.gen(function* () {
    const reservations = yield* WorkspaceReservationRepository;
    const paymentAttempts = yield* PaymentAttemptRepository;
    const paymentLifecycle = yield* PaymentLifecycleRepository;
    const nexi = yield* NexiService;
    const fulfillment = yield* WorkspacePaidFulfillmentService;
    const posthogEvents = yield* PostHogEventService;

    return ProviderPaymentFinalizationService.of({
      finalizePendingProviderPayment: Effect.fn(
        "providerPaymentFinalization.finalizePendingProviderPayment"
      )(
        function* (input) {
          yield* Effect.annotateLogsScoped({ input });
          yield* Effect.logInfo("Provider payment finalization started");

          const reservation = yield* reservations.findById(input.orderId).pipe(
            Effect.tapError((cause) =>
              Effect.logError(
                "Payment finalization reservation lookup failed",
                {
                  orderId: input.orderId,
                  cause,
                }
              )
            ),
            Effect.orElseSucceed(() => null)
          );
          const paymentAttemptId =
            input.paymentAttemptId ?? reservation?.activePaymentAttemptId;
          yield* Effect.annotateLogsScoped({ paymentAttemptId });
          yield* Effect.logDebug(
            "Payment finalization reservation lookup completed"
          );

          if (!reservation || !paymentAttemptId) {
            yield* Effect.logInfo("Payment finalization returned not_found");
            return "not_found";
          }

          const attempt = yield* paymentAttempts
            .findById(paymentAttemptId)
            .pipe(
              Effect.tapError((cause) =>
                Effect.logError("Payment finalization attempt lookup failed", {
                  orderId: reservation.id,
                  paymentAttemptId,
                  cause,
                })
              ),
              Effect.orElseSucceed(() => null)
            );
          yield* Effect.logDebug(
            "Payment finalization attempt lookup completed"
          );
          if (!attempt) {
            yield* Effect.logWarning(
              "Payment finalization returned provider_verification_failed"
            );
            return "provider_verification_failed";
          }
          if (
            attempt.workspaceReservationId !== reservation.id ||
            reservation.activePaymentAttemptId !== attempt.id
          ) {
            yield* Effect.logWarning(
              "Payment finalization returned not_pending for a non-active attempt"
            );
            return "not_pending";
          }

          const currency = yield* Schema.decodeUnknownEffect(
            NexiCurrencySchema
          )(attempt.amount.currency).pipe(
            Effect.tapError((cause) =>
              Effect.logError("Payment finalization currency decode failed", {
                orderId: input.orderId,
                paymentAttemptId: attempt.id,
                cause,
              })
            ),
            Effect.orElseSucceed(() => undefined)
          );
          yield* Effect.annotateLogsScoped({ currency });
          yield* Effect.logDebug("Payment finalization currency decoded");
          if (!currency) {
            yield* Effect.logWarning(
              "Payment finalization returned provider_verification_failed"
            );
            return "provider_verification_failed";
          }

          yield* Effect.logInfo(
            "Payment finalization provider verification started"
          );
          const verification = yield* nexi
            .verifyPaymentOutcome({
              orderId: attempt.providerOrderId,
              correlationId: reservation.correlationId,
              amount: String(attempt.amount.value),
              currency: getNexiCurrencyOverride() ?? currency,
              ...(attempt.securityToken
                ? { securityToken: attempt.securityToken }
                : {}),
            })
            .pipe(
              Effect.tapError((cause) =>
                Effect.logError("Nexi payment outcome verification failed", {
                  orderId: reservation.id,
                  paymentAttemptId: attempt.id,
                  providerOrderId: attempt.providerOrderId,
                  cause,
                })
              ),
              Effect.orElseSucceed(() => undefined)
            );

          yield* Effect.logInfo(
            "Payment finalization provider verification completed"
          );

          if (!verification) {
            yield* Effect.logWarning(
              "Payment finalization returned provider_verification_failed"
            );
            return "provider_verification_failed";
          }
          if (
            verification.status === "manual_review" ||
            verification.mismatches.length > 0
          ) {
            yield* paymentLifecycle.recordEvidenceConflict({
              id: attempt.id,
              workspaceReservationId: reservation.id,
              conflictCodes: getProviderEvidenceConflictCodes(verification),
            });
            yield* Effect.logWarning(
              "Payment finalization returned verification_mismatch"
            );
            return "verification_mismatch";
          }

          const { providerOperationId, providerStatus } =
            getNexiPaymentMetadata(verification);
          yield* Effect.annotateLogsScoped({
            providerMetadata: { providerOperationId, providerStatus },
          });
          yield* Effect.logDebug(
            "Payment finalization provider metadata resolved"
          );

          if (verification.status === "success") {
            yield* Effect.logInfo("Payment finalization mark paid started");
            const paidSettlement = yield* paymentLifecycle
              .markPaid({
                id: attempt.id,
                workspaceReservationId: reservation.id,
                webhookEventId: input.webhookEventId,
                providerOperationId,
                providerStatus,
                paidAt: Temporal.Now.instant(),
              })
              .pipe(
                Effect.map((transition) => ({
                  outcome: "settled" as const,
                  transition,
                })),
                Effect.catchTag("PaymentLifecycleStateError", (cause) =>
                  Effect.gen(function* () {
                    if (cause.reason === "provider_evidence_conflict") {
                      yield* paymentLifecycle.recordEvidenceConflict({
                        id: attempt.id,
                        workspaceReservationId: reservation.id,
                        conflictCodes: ["provider_terminal_state"],
                      });
                    }
                    yield* Effect.logWarning(
                      "Payment finalization mark paid returned lifecycle conflict",
                      { cause }
                    );
                    return {
                      outcome:
                        cause.reason === "provider_evidence_conflict"
                          ? ("manual_review" as const)
                          : ("not_pending" as const),
                    };
                  })
                )
              );

            if (paidSettlement.outcome !== "settled") {
              return paidSettlement.outcome;
            }
            const paidSuccess = paidSettlement.transition;
            if (paidSuccess.changed) {
              yield* capturePaymentCompleted({
                attempt: paidSuccess.attempt,
                timestamp: paidSuccess.timestamp,
              }).pipe(
                Effect.provideService(PostHogEventService, posthogEvents)
              );
            }
            yield* Effect.logDebug("Payment finalization mark paid completed");

            if (
              reservation.paymentState === "pending" ||
              (reservation.paymentState === "paid" &&
                (reservation.fulfillmentState === "not_started" ||
                  reservation.fulfillmentState === "processing"))
            ) {
              yield* Effect.logInfo("Payment finalization fulfillment invoked");
              yield* fulfillment
                .fulfillPaidOrder({ orderId: reservation.id })
                .pipe(
                  Effect.tapError((cause) =>
                    Effect.logFatal(
                      "Paid order fulfillment failed during finalization",
                      {
                        orderId: reservation.id,
                        paymentAttemptId: attempt.id,
                        cause,
                      }
                    )
                  ),
                  Effect.ignore
                );
              yield* Effect.logInfo(
                "Payment finalization fulfillment completed"
              );
            }
            return "paid";
          }

          if (verification.status === "failure") {
            const failureKind = classifyNexiFailureStatus(providerStatus);
            const terminalState = failureKind;
            yield* Effect.annotateLogsScoped({ failureKind, terminalState });

            yield* Effect.logInfo("Payment finalization mark terminal started");
            const terminalSettlement = yield* paymentLifecycle
              .markTerminal({
                id: attempt.id,
                workspaceReservationId: reservation.id,
                state: terminalState,
                failureCode: "nexi_payment_failed",
                webhookEventId: input.webhookEventId,
                providerOperationId,
                providerStatus,
              })
              .pipe(
                Effect.map((transition) => ({
                  outcome: "settled" as const,
                  transition,
                })),
                Effect.catchTag("PaymentLifecycleStateError", (cause) =>
                  Effect.gen(function* () {
                    if (cause.reason === "provider_evidence_conflict") {
                      yield* paymentLifecycle.recordEvidenceConflict({
                        id: attempt.id,
                        workspaceReservationId: reservation.id,
                        conflictCodes: ["provider_terminal_state"],
                      });
                    }
                    yield* Effect.logWarning(
                      "Payment finalization mark terminal returned lifecycle conflict",
                      { cause }
                    );
                    return {
                      outcome:
                        cause.reason === "provider_evidence_conflict"
                          ? ("manual_review" as const)
                          : ("not_pending" as const),
                    };
                  })
                )
              );

            if (terminalSettlement.outcome !== "settled") {
              return terminalSettlement.outcome;
            }
            const terminalSuccess = terminalSettlement.transition;
            if (terminalSuccess.changed) {
              if (terminalState === "failed") {
                yield* capturePaymentFailed({
                  attempt: terminalSuccess.attempt,
                  failureCode:
                    terminalSuccess.attempt.lastProviderStatus ??
                    terminalSuccess.attempt.failureCode ??
                    "nexi_payment_failed",
                  failureReason: "nexi_payment_failed",
                  timestamp: terminalSuccess.timestamp,
                }).pipe(
                  Effect.provideService(PostHogEventService, posthogEvents)
                );
              } else {
                yield* capturePaymentAbandoned({
                  attempt: terminalSuccess.attempt,
                  timestamp: terminalSuccess.timestamp,
                }).pipe(
                  Effect.provideService(PostHogEventService, posthogEvents)
                );
              }
            }
            yield* Effect.logDebug(
              "Payment finalization mark terminal completed"
            );

            return "terminal";
          }

          yield* Effect.logInfo("Payment finalization returned pending");
          return "pending";
        },
        (effect, input) =>
          effect.pipe(
            Effect.scoped,
            Effect.tap((result) =>
              Effect.logInfo("Provider payment finalization completed", {
                result,
              })
            ),
            Effect.annotateLogs({ input })
          )
      ),
    });
  })
);

export const ProviderPaymentFinalizationServiceLiveWithDependencies =
  ProviderPaymentFinalizationServiceLive.pipe(
    Layer.provide(PaymentAttemptRepositoryLive),
    Layer.provide(PaymentLifecycleRepository.Live),
    Layer.provide(PostHogEventServiceLive),
    Layer.provide(WorkspaceReservationRepositoryLive),
    Layer.provide(WorkspaceDatabaseLive),
    Layer.provide(WorkspacePaidFulfillmentServiceLiveWithDependencies),
    Layer.provide(NexiServiceLive)
  );
