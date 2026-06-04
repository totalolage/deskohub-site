import { DotyposService } from "@deskohub/dotypos";
import {
  classifyNexiFailureStatus,
  getNexiPaymentMetadata,
  NexiCurrencySchema,
  NexiService,
} from "@deskohub/nexi";
import { Context, Effect, Layer, Schema } from "effect";
import { WorkspaceDatabaseLive } from "@/db/database.service";
import {
  WorkspacePaidFulfillmentService,
  WorkspacePaidFulfillmentServiceLiveWithDependencies,
} from "@/features/checkout/backend/paid-fulfillment.service";
import {
  PaymentAttemptRepository,
  PaymentAttemptRepositoryLive,
} from "@/features/checkout/backend/payment-attempt.repository";
import {
  WorkspaceReservationRepository,
  WorkspaceReservationRepositoryLive,
} from "@/features/checkout/backend/workspace-reservation.repository";
import { DotyposRuntimeConfigLive } from "@/shared/backend/config/dotypos.config";
import { NexiServiceLive } from "@/shared/backend/config/nexi.config";

export type ProviderPaymentFinalizationResult =
  | "not_found"
  | "not_pending"
  | "not_verifiable"
  | "verification_mismatch"
  | "pending"
  | "paid"
  | "terminal";

export interface ProviderPaymentFinalizationService {
  readonly finalizePendingProviderPayment: (input: {
    readonly orderId: string;
    readonly paymentAttemptId?: string;
    readonly webhookEventId?: string;
  }) => Effect.Effect<ProviderPaymentFinalizationResult, never>;
}

export const ProviderPaymentFinalizationService =
  Context.GenericTag<ProviderPaymentFinalizationService>(
    "ProviderPaymentFinalizationService"
  );

export const ProviderPaymentFinalizationServiceLive = Layer.effect(
  ProviderPaymentFinalizationService,
  Effect.gen(function* () {
    const reservations = yield* WorkspaceReservationRepository;
    const paymentAttempts = yield* PaymentAttemptRepository;
    const nexi = yield* NexiService;
    const fulfillment = yield* WorkspacePaidFulfillmentService;

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
          yield* Effect.annotateLogsScoped({ reservation, paymentAttemptId });
          yield* Effect.logDebug(
            "Payment finalization reservation lookup completed"
          );

          if (!reservation || !paymentAttemptId) {
            yield* Effect.logWarning("Payment finalization returned not_found");
            return "not_found";
          }
          if (reservation.paymentState !== "pending") {
            if (
              reservation.paymentState === "paid" &&
              reservation.fulfillmentState !== "fulfilled"
            ) {
              yield* Effect.logInfo(
                "Payment finalization invoking fulfillment for already-paid reservation"
              );
              yield* fulfillment
                .fulfillPaidOrder({ orderId: reservation.id })
                .pipe(
                  Effect.tapError((cause) =>
                    Effect.logError(
                      "Paid order fulfillment failed during finalization",
                      {
                        orderId: reservation.id,
                        cause,
                      }
                    )
                  ),
                  Effect.ignore
                );
              yield* Effect.logInfo(
                "Payment finalization fulfillment completed for already-paid reservation"
              );
              return "paid";
            }

            yield* Effect.logWarning(
              "Payment finalization returned not_pending"
            );
            return "not_pending";
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
          yield* Effect.annotateLogsScoped({ attempt });
          yield* Effect.logDebug(
            "Payment finalization attempt lookup completed"
          );
          if (!attempt?.securityToken) {
            yield* Effect.logWarning(
              "Payment finalization returned not_verifiable"
            );
            return "not_verifiable";
          }

          const currency = yield* Schema.decodeUnknown(NexiCurrencySchema)(
            attempt.currency
          ).pipe(
            Effect.tapError((cause) =>
              Effect.logError("Payment finalization currency decode failed", {
                input,
                reservation,
                attempt,
                cause,
              })
            ),
            Effect.orElseSucceed(() => undefined)
          );
          yield* Effect.annotateLogsScoped({ currency });
          yield* Effect.logDebug("Payment finalization currency decoded");
          if (!currency) {
            yield* Effect.logWarning(
              "Payment finalization returned not_verifiable"
            );
            return "not_verifiable";
          }

          yield* Effect.logInfo(
            "Payment finalization provider verification started"
          );
          const verification = yield* nexi
            .verifyPaymentOutcome({
              orderId: attempt.providerOrderId,
              correlationId: reservation.correlationId,
              amount: String(attempt.amountValue),
              currency,
              securityToken: attempt.securityToken,
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

          yield* Effect.annotateLogsScoped({ verification });
          yield* Effect.logInfo(
            "Payment finalization provider verification completed"
          );

          if (!verification) {
            yield* Effect.logWarning(
              "Payment finalization returned not_verifiable"
            );
            return "not_verifiable";
          }
          if (verification.mismatches.length > 0) {
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
            const paid = yield* paymentAttempts
              .markPaidForReservation({
                id: attempt.id,
                workspaceReservationId: reservation.id,
                webhookEventId: input.webhookEventId,
                providerOperationId,
                providerStatus,
                paidAt: new Date(),
              })
              .pipe(Effect.either);

            if (paid._tag === "Left") {
              yield* Effect.logWarning(
                "Payment finalization mark paid returned not_pending",
                { paid }
              );
              return "not_pending";
            }
            yield* Effect.logDebug("Payment finalization mark paid completed");

            yield* Effect.logInfo("Payment finalization fulfillment invoked");
            yield* fulfillment
              .fulfillPaidOrder({ orderId: reservation.id })
              .pipe(
                Effect.tapError((cause) =>
                  Effect.logError(
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
            yield* Effect.logInfo("Payment finalization fulfillment completed");
            return "paid";
          }

          if (verification.status === "failure") {
            const failureKind = classifyNexiFailureStatus(providerStatus);
            const terminalState =
              failureKind === "cancelled"
                ? "cancelled"
                : failureKind === "expired"
                  ? "expired"
                  : "failed";
            yield* Effect.annotateLogsScoped({ failureKind, terminalState });

            yield* Effect.logInfo("Payment finalization mark terminal started");
            const terminal = yield* paymentAttempts
              .markTerminalForReservation({
                id: attempt.id,
                workspaceReservationId: reservation.id,
                state: terminalState,
                failureCode: "nexi_payment_failed",
                webhookEventId: input.webhookEventId,
                providerOperationId,
                providerStatus,
              })
              .pipe(Effect.either);

            if (terminal._tag === "Left") {
              yield* Effect.logWarning(
                "Payment finalization mark terminal returned not_pending",
                { terminal }
              );
              return "not_pending";
            }
            yield* Effect.logDebug(
              "Payment finalization mark terminal completed"
            );

            return "terminal";
          }

          yield* Effect.logWarning("Payment finalization returned pending");
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
    Layer.provide(WorkspaceReservationRepositoryLive),
    Layer.provide(WorkspaceDatabaseLive),
    Layer.provide(
      Layer.provide(DotyposService.Default, DotyposRuntimeConfigLive)
    ),
    Layer.provide(WorkspacePaidFulfillmentServiceLiveWithDependencies),
    Layer.provide(NexiServiceLive)
  );
