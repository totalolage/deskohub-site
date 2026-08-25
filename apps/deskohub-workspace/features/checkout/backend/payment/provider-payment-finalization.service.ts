import {
  classifyNexiFailureStatus,
  getNexiPaymentMetadata,
  NexiCurrencySchema,
  NexiService,
  type NexiWebhookEventId,
} from "@deskohub/nexi";
import { Context, Effect, Layer, Match, Schema } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import type { PaymentAttemptId } from "@/features/checkout/checkout-identifiers";
import { type OrderId, orderIdSchema } from "@/features/order";
import { OrderRepository } from "@/features/order/backend/order.repository";
import { PostHogEventService } from "@/shared/backend/analytics/posthog-event.service";
import { WorkspaceNexiLayer } from "@/shared/backend/config/nexi.config";
import { getProviderOrderAbandonmentState } from "../../provider-order-abandonment";
import {
  capturePaymentAbandoned,
  capturePaymentCompleted,
  capturePaymentFailed,
} from "../analytics/posthog-lifecycle-events";
import { PaidOrderCompletionService } from "../fulfillment/paid-order-completion.service";
import {
  isNexiPaymentAttempt,
  PaymentAttemptRepository,
} from "../repositories/payment-attempt.repository";
import {
  PaymentLifecycleRepository,
  type PaymentLifecycleRepositoryError,
} from "../repositories/payment-lifecycle.repository";
import { getNexiCurrencyOverride } from "./nexi-currency";

export type ProviderPaymentFinalizationResult =
  | "abandoned"
  | "deferred"
  | "not_found"
  | "not_pending"
  | "not_verifiable"
  | "provider_verification_failed"
  | "verification_mismatch"
  | "pending"
  | "paid"
  | "terminal";

export interface IProviderPaymentFinalizationService {
  readonly finalizePendingProviderPayment: (input: {
    readonly orderId: OrderId;
    readonly paymentAttemptId?: PaymentAttemptId;
    readonly webhookEventId?: NexiWebhookEventId;
    readonly abandonmentCheckedAt?: Temporal.Instant;
  }) => Effect.Effect<
    ProviderPaymentFinalizationResult,
    PaymentLifecycleRepositoryError
  >;
}

export class ProviderPaymentFinalizationService extends Context.Service<
  ProviderPaymentFinalizationService,
  IProviderPaymentFinalizationService
>()("ProviderPaymentFinalizationService") {
  static Default = makeProviderPaymentFinalizationServiceLayer(this);

  static Live = this.Default.pipe(
    Layer.provide(PaymentAttemptRepository.Default),
    Layer.provide(PaymentLifecycleRepository.Default),
    Layer.provide(PostHogEventService.Live),
    Layer.provide(OrderRepository.Default),
    Layer.provide(WorkspaceDatabase.Default),
    Layer.provide(PaidOrderCompletionService.Live),
    Layer.provide(WorkspaceNexiLayer)
  );
}

function makeProviderPaymentFinalizationServiceLayer(
  service: typeof ProviderPaymentFinalizationService
) {
  return Layer.effect(
    service,
    Effect.gen(function* () {
      const orders = yield* OrderRepository;
      const paymentAttempts = yield* PaymentAttemptRepository;
      const paymentLifecycle = yield* PaymentLifecycleRepository;
      const nexi = yield* NexiService;
      const completion = yield* PaidOrderCompletionService;
      const posthogEvents = yield* PostHogEventService;

      return ProviderPaymentFinalizationService.of({
        finalizePendingProviderPayment: Effect.fn(
          "providerPaymentFinalization.finalizePendingProviderPayment"
        )(
          function* (input) {
            yield* Effect.annotateLogsScoped({ input });
            yield* Effect.logInfo("Provider payment finalization started");

            const order = yield* orders.findById(input.orderId).pipe(
              Effect.tapError((cause) =>
                Effect.logError("Payment finalization order lookup failed", {
                  orderId: input.orderId,
                  cause,
                })
              ),
              Effect.orElseSucceed(() => null)
            );
            const paymentAttemptId =
              input.paymentAttemptId ?? order?.activePaymentAttemptId;
            yield* Effect.annotateLogsScoped({ order, paymentAttemptId });
            yield* Effect.logDebug(
              "Payment finalization order lookup completed"
            );

            if (!order || !paymentAttemptId) {
              yield* Effect.logInfo("Payment finalization returned not_found");
              return "not_found";
            }
            const reconcileGoodsAttempt = Match.value(order.kind).pipe(
              Match.when("reservation", () => false),
              Match.when(
                "goods",
                () =>
                  ["failed", "cancelled", "expired"].includes(
                    order.paymentState
                  ) ||
                  (order.paymentState === "paid" &&
                    paymentAttemptId !== order.activePaymentAttemptId)
              ),
              Match.exhaustive
            );
            if (order.paymentState !== "pending" && !reconcileGoodsAttempt) {
              if (
                order.paymentState === "paid" &&
                (order.fulfillmentState === "not_started" ||
                  order.fulfillmentState === "processing" ||
                  order.fulfillmentState === "fulfilled")
              ) {
                yield* Effect.logWarning(
                  "Payment finalization invoking completion for already-paid order"
                );
                yield* completion
                  .complete({
                    orderId: order.id,
                    kind: order.kind,
                    paymentAttemptId,
                  })
                  .pipe(
                    Effect.tapError((cause) =>
                      Effect.logFatal(
                        "Paid order completion failed during finalization",
                        {
                          orderId: order.id,
                          cause,
                        }
                      )
                    ),
                    Effect.ignore
                  );
                yield* Effect.logInfo(
                  "Payment finalization completion finished for already-paid order"
                );
                return "paid";
              }

              yield* Effect.logInfo(
                "Payment finalization returned not_pending"
              );
              return "not_pending";
            }

            const attempt = yield* paymentAttempts
              .findById(paymentAttemptId)
              .pipe(
                Effect.tapError((cause) =>
                  Effect.logError(
                    "Payment finalization attempt lookup failed",
                    {
                      orderId: order.id,
                      paymentAttemptId,
                      cause,
                    }
                  )
                ),
                Effect.orElseSucceed(() => null)
              );
            yield* Effect.annotateLogsScoped({ attempt });
            yield* Effect.logDebug(
              "Payment finalization attempt lookup completed"
            );
            if (
              !attempt ||
              !isNexiPaymentAttempt(attempt) ||
              !attempt.securityToken
            ) {
              yield* Effect.logWarning(
                "Payment finalization returned not_verifiable"
              );
              return "not_verifiable";
            }

            const currency = yield* Schema.decodeUnknownEffect(
              NexiCurrencySchema
            )(attempt.amount.currency).pipe(
              Effect.tapError((cause) =>
                Effect.logError("Payment finalization currency decode failed", {
                  input,
                  order,
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
                correlationId: order.correlationId,
                amount: String(attempt.amount.value),
                currency: getNexiCurrencyOverride() ?? currency,
                securityToken: attempt.securityToken,
              })
              .pipe(
                Effect.tapError((cause) =>
                  Effect.logError("Nexi payment outcome verification failed", {
                    orderId: order.id,
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
                "Payment finalization returned provider_verification_failed"
              );
              return "provider_verification_failed";
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
              const paidSuccess = yield* paymentLifecycle
                .markPaid({
                  id: attempt.id,
                  orderId: orderIdSchema.make(order.id),
                  webhookEventId: input.webhookEventId,
                  providerOperationId,
                  providerStatus,
                  paidAt: Temporal.Now.instant(),
                })
                .pipe(
                  Effect.catchTag("PaymentLifecycleStateError", (cause) =>
                    Effect.gen(function* () {
                      yield* Effect.logWarning(
                        "Payment finalization mark paid returned not_pending",
                        { cause }
                      );
                      return undefined;
                    })
                  )
                );

              if (!paidSuccess) {
                return "not_pending";
              }
              if (paidSuccess.changed) {
                yield* capturePaymentCompleted({
                  attempt: paidSuccess.attempt,
                  timestamp: paidSuccess.timestamp,
                }).pipe(
                  Effect.provideService(PostHogEventService, posthogEvents)
                );
              }
              yield* Effect.logDebug(
                "Payment finalization mark paid completed"
              );

              if (paidSuccess.attempt.refundState !== "required") {
                yield* Effect.logInfo(
                  "Payment finalization completion invoked"
                );
                yield* completion
                  .complete({
                    orderId: order.id,
                    kind: order.kind,
                    paymentAttemptId: attempt.id,
                  })
                  .pipe(
                    Effect.tapError((cause) =>
                      Effect.logFatal(
                        "Paid order completion failed during finalization",
                        {
                          orderId: order.id,
                          paymentAttemptId: attempt.id,
                          cause,
                        }
                      )
                    ),
                    Effect.ignore
                  );
                yield* Effect.logInfo(
                  "Payment finalization completion finished"
                );
              }
              return "paid";
            }

            if (verification.status === "failure") {
              const failureKind = classifyNexiFailureStatus(providerStatus);
              const terminalState = failureKind;
              yield* Effect.annotateLogsScoped({ failureKind, terminalState });

              yield* Effect.logInfo(
                "Payment finalization mark terminal started"
              );
              const terminalSuccess = yield* paymentLifecycle
                .markTerminal({
                  id: attempt.id,
                  orderId: orderIdSchema.make(order.id),
                  state: terminalState,
                  failureCode: "nexi_payment_failed",
                  webhookEventId: input.webhookEventId,
                  providerOperationId,
                  providerStatus,
                })
                .pipe(
                  Effect.catchTag("PaymentLifecycleStateError", (cause) =>
                    Effect.gen(function* () {
                      yield* Effect.logWarning(
                        "Payment finalization mark terminal returned not_pending",
                        { cause }
                      );
                      return undefined;
                    })
                  )
                );

              if (!terminalSuccess) {
                return "not_pending";
              }
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

            const emptyOrderResult = getProviderOrderAbandonmentState({
              checkedAt: input.abandonmentCheckedAt,
              providerOrderCreatedAt: attempt.providerOrderCreatedAt,
              order: verification.provider,
            });
            if (emptyOrderResult !== "not_empty") {
              yield* Effect.logInfo(
                "Payment finalization resolved empty provider order",
                { result: emptyOrderResult }
              );
              return emptyOrderResult;
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
}
