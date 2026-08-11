import "server-only";

import {
  checkNexiWebhookSecurityToken,
  classifyNexiFailureStatus,
  decodeNexiWebhookNotification,
  deriveNexiWebhookEventIdentity,
  getNexiPaymentMetadata,
  NexiCurrencySchema,
  type NexiOrderId,
  NexiService,
  type NexiWebhookEventId,
} from "@deskohub/nexi";
import { Context, Data, Effect, Layer, Schema } from "effect";
import { getNexiCurrencyOverride } from "@/features/checkout/backend/payment/nexi-currency";
import { PostHogEventService } from "@/shared/backend/analytics/posthog-event.service";
import { MobileShopPaidFulfillmentService } from "./paid-fulfillment.service";
import {
  captureMobileShopPaymentCompleted,
  captureMobileShopPaymentTerminal,
} from "./posthog-lifecycle-events";
import {
  type MobileShopPaymentRecord,
  MobileShopPurchaseLifecycleRepository,
} from "./purchase-lifecycle.repository";

export type MobileShopNexiWebhookFailureCode =
  | "mobile_shop_nexi_parse_failed"
  | "mobile_shop_nexi_unknown_order"
  | "mobile_shop_nexi_missing_security_token"
  | "mobile_shop_nexi_verification_failed"
  | "mobile_shop_nexi_verification_mismatch"
  | "mobile_shop_nexi_transition_failed";

export class MobileShopNexiWebhookError extends Data.TaggedError(
  "MobileShopNexiWebhookError"
)<{
  readonly code: MobileShopNexiWebhookFailureCode;
  readonly retryProvider: boolean;
  readonly eventId?: NexiWebhookEventId;
  readonly orderId?: NexiOrderId;
  readonly cause?: unknown;
}> {}

export interface MobileShopNexiWebhookResult {
  readonly status: "accepted" | "duplicate";
  readonly eventId: NexiWebhookEventId;
  readonly orderId: NexiOrderId;
}

export interface IMobileShopNexiWebhookService {
  readonly processNotification: (
    payload: unknown
  ) => Effect.Effect<MobileShopNexiWebhookResult, MobileShopNexiWebhookError>;
}

export class MobileShopNexiWebhookService extends Context.Service<
  MobileShopNexiWebhookService,
  IMobileShopNexiWebhookService
>()("@deskohub-workspace/mobile-shop/MobileShopNexiWebhookService") {
  static Live = Layer.effect(
    this,
    Effect.gen(function* () {
      const purchases = yield* MobileShopPurchaseLifecycleRepository;
      const nexi = yield* NexiService;
      const fulfillment = yield* MobileShopPaidFulfillmentService;
      const posthog = yield* PostHogEventService;

      return {
        processNotification: Effect.fn(
          "MobileShopNexiWebhookService.processNotification"
        )(
          function* (payload) {
            const envelope = yield* decodeNexiWebhookNotification(payload).pipe(
              Effect.mapError(
                (cause) =>
                  new MobileShopNexiWebhookError({
                    code: "mobile_shop_nexi_parse_failed",
                    retryProvider: false,
                    cause,
                  })
              )
            );
            const orderId = envelope.operation.orderId;
            const { eventId } = deriveNexiWebhookEventIdentity(envelope);
            const claimed = yield* purchases
              .claimWebhook({
                eventId,
                receivedAt: Temporal.Now.instant(),
              })
              .pipe(
                Effect.mapError(
                  (cause) =>
                    new MobileShopNexiWebhookError({
                      code: "mobile_shop_nexi_transition_failed",
                      retryProvider: true,
                      eventId,
                      orderId,
                      cause,
                    })
                )
              );
            if (claimed.kind === "duplicate") {
              return { status: "duplicate" as const, eventId, orderId };
            }
            if (claimed.kind === "busy") {
              return yield* new MobileShopNexiWebhookError({
                code: "mobile_shop_nexi_transition_failed",
                retryProvider: true,
                eventId,
                orderId,
              });
            }

            const payment = yield* purchases
              .findPaymentByProviderOrderId(orderId)
              .pipe(
                Effect.mapError((cause) =>
                  webhookError({
                    code: "mobile_shop_nexi_transition_failed",
                    retryProvider: true,
                    eventId,
                    orderId,
                    cause,
                  })
                )
              );
            if (!payment) {
              return yield* failWebhook({
                code: "mobile_shop_nexi_unknown_order",
                retryProvider: false,
                eventId,
                orderId,
                purchases,
              });
            }

            const tokenCheck = checkNexiWebhookSecurityToken({
              notificationSecurityToken: envelope.securityToken,
              expectedSecurityToken: payment.attempt.securityToken,
            });
            if (tokenCheck.status === "mismatch") {
              return yield* failWebhook({
                code: "mobile_shop_nexi_verification_mismatch",
                retryProvider: false,
                eventId,
                orderId,
                payment,
                purchases,
              });
            }
            if (!payment.attempt.securityToken) {
              return yield* failWebhook({
                code: "mobile_shop_nexi_missing_security_token",
                retryProvider: false,
                eventId,
                orderId,
                payment,
                purchases,
              });
            }

            const currency = yield* Schema.decodeUnknownEffect(
              NexiCurrencySchema
            )(payment.attempt.currency).pipe(
              Effect.mapError((cause) =>
                webhookError({
                  code: "mobile_shop_nexi_verification_mismatch",
                  retryProvider: false,
                  eventId,
                  orderId,
                  cause,
                })
              ),
              Effect.catch((error) =>
                failKnownWebhook({
                  error,
                  eventId,
                  orderId,
                  payment,
                  purchases,
                })
              )
            );
            const verification = yield* nexi
              .verifyPaymentOutcome({
                orderId,
                correlationId: payment.order.correlationId,
                amount: String(payment.attempt.amountValue),
                currency: getNexiCurrencyOverride() ?? currency,
                securityToken: payment.attempt.securityToken,
              })
              .pipe(
                Effect.mapError((cause) =>
                  webhookError({
                    code: "mobile_shop_nexi_verification_failed",
                    retryProvider: true,
                    eventId,
                    orderId,
                    cause,
                  })
                ),
                Effect.catch((error) =>
                  failKnownWebhook({
                    error,
                    eventId,
                    orderId,
                    payment,
                    purchases,
                  })
                )
              );
            if (verification.mismatches.length > 0) {
              return yield* failWebhook({
                code: "mobile_shop_nexi_verification_mismatch",
                retryProvider: false,
                eventId,
                orderId,
                payment,
                purchases,
              });
            }

            const metadata = getNexiPaymentMetadata(verification);
            let resultCode = "pending";
            if (verification.status === "success") {
              const transition = yield* purchases
                .markPaid({
                  paymentAttemptId: payment.attempt.id,
                  webhookEventId: eventId,
                  providerOperationId: metadata.providerOperationId,
                  providerStatus: metadata.providerStatus,
                  paidAt: Temporal.Now.instant(),
                })
                .pipe(
                  Effect.mapError((cause) =>
                    webhookError({
                      code: "mobile_shop_nexi_transition_failed",
                      retryProvider: true,
                      eventId,
                      orderId,
                      cause,
                    })
                  ),
                  Effect.catch((error) =>
                    failKnownWebhook({
                      error,
                      eventId,
                      orderId,
                      payment,
                      purchases,
                    })
                  )
                );
              if (transition.changed) {
                yield* captureMobileShopPaymentCompleted(transition).pipe(
                  Effect.provideService(PostHogEventService, posthog)
                );
              }
              if (transition.additionalPayment) {
                yield* Effect.logFatal(
                  "A second mobile shop payment attempt was verified paid",
                  {
                    purchaseId: transition.payment.order.id,
                    paymentAttemptId: transition.payment.attempt.id,
                  }
                );
              }
              yield* fulfillment.fulfillPaidPurchase({
                purchaseId: payment.order.id,
              });
              resultCode = "paid";
            } else if (verification.status === "failure") {
              if (payment.order.paymentState === "paid") {
                resultCode = "ignored_after_paid";
              } else if (
                ["failed", "cancelled", "expired"].includes(
                  payment.order.paymentState
                )
              ) {
                resultCode = "already_terminal";
              } else {
                const state = classifyNexiFailureStatus(
                  metadata.providerStatus
                );
                const transition = yield* purchases
                  .markTerminal({
                    paymentAttemptId: payment.attempt.id,
                    webhookEventId: eventId,
                    providerOperationId: metadata.providerOperationId,
                    providerStatus: metadata.providerStatus,
                    state,
                    failureCode: "nexi_payment_failed",
                  })
                  .pipe(
                    Effect.mapError((cause) =>
                      webhookError({
                        code: "mobile_shop_nexi_transition_failed",
                        retryProvider: true,
                        eventId,
                        orderId,
                        cause,
                      })
                    ),
                    Effect.catch((error) =>
                      failKnownWebhook({
                        error,
                        eventId,
                        orderId,
                        payment,
                        purchases,
                      })
                    )
                  );
                if (transition.changed) {
                  yield* captureMobileShopPaymentTerminal(transition).pipe(
                    Effect.provideService(PostHogEventService, posthog)
                  );
                }
                resultCode = state;
              }
            }

            yield* purchases
              .markWebhookProcessed({
                eventId,
                purchaseId: payment.order.id,
                paymentAttemptId: payment.attempt.id,
                resultCode,
                processedAt: Temporal.Now.instant(),
              })
              .pipe(
                Effect.mapError((cause) =>
                  webhookError({
                    code: "mobile_shop_nexi_transition_failed",
                    retryProvider: true,
                    eventId,
                    orderId,
                    cause,
                  })
                )
              );
            return { status: "accepted" as const, eventId, orderId };
          },
          (effect) =>
            effect.pipe(
              Effect.annotateLogs({ provider: "nexi", product: "mobile-shop" }),
              Effect.scoped
            )
        ),
      } satisfies IMobileShopNexiWebhookService;
    })
  );
}

const webhookError = (
  input: ConstructorParameters<typeof MobileShopNexiWebhookError>[0]
) => new MobileShopNexiWebhookError(input);

const failWebhook = (input: {
  readonly code: MobileShopNexiWebhookFailureCode;
  readonly retryProvider: boolean;
  readonly eventId: NexiWebhookEventId;
  readonly orderId: NexiOrderId;
  readonly payment?: MobileShopPaymentRecord;
  readonly cause?: unknown;
  readonly purchases: typeof MobileShopPurchaseLifecycleRepository.Service;
}) => {
  const error = webhookError({
    code: input.code,
    retryProvider: input.retryProvider,
    eventId: input.eventId,
    orderId: input.orderId,
    cause: input.cause,
  });
  return input.purchases
    .markWebhookFailed({
      eventId: input.eventId,
      purchaseId: input.payment?.order.id,
      paymentAttemptId: input.payment?.attempt.id,
      resultCode: input.code,
    })
    .pipe(
      Effect.tapError((cause) =>
        Effect.logFatal("Mobile shop webhook failure marker failed", {
          eventId: input.eventId,
          code: input.code,
          cause,
        })
      ),
      Effect.ignore,
      Effect.andThen(Effect.fail(error))
    );
};

const failKnownWebhook = (input: {
  readonly error: MobileShopNexiWebhookError;
  readonly eventId: NexiWebhookEventId;
  readonly orderId: NexiOrderId;
  readonly payment: MobileShopPaymentRecord;
  readonly purchases: typeof MobileShopPurchaseLifecycleRepository.Service;
}) =>
  failWebhook({
    code: input.error.code,
    retryProvider: input.error.retryProvider,
    eventId: input.eventId,
    orderId: input.orderId,
    payment: input.payment,
    cause: input.error.cause,
    purchases: input.purchases,
  });
