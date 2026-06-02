import { randomUUID } from "node:crypto";
import {
  checkNexiWebhookSecurityToken,
  classifyNexiFailureStatus,
  decodeNexiWebhookNotification,
  deriveNexiWebhookEventIdentity,
  getNexiPaymentMetadata,
  type NexiCurrency,
  NexiService,
  type PaymentVerificationResult,
} from "@deskohub/nexi";
import { DotyposService } from "@deskohub/dotypos";
import { Context, Data, Effect, Layer, Schema } from "effect";
import { WorkspaceDatabaseLive } from "@/db/database.service";
import type { PaymentOrder } from "@/db/schema";
import { NexiAmountFromWorkspaceMoney } from "@/features/checkout/backend/nexi-amount.codec";
import {
  WorkspacePaidFulfillmentService,
  WorkspacePaidFulfillmentServiceLiveWithDependencies,
} from "@/features/checkout/backend/paid-fulfillment.service";
import {
  PaymentOrderRepository,
  PaymentOrderRepositoryLive,
} from "@/features/checkout/backend/payment-order.repository";
import {
  ReservationHoldCleanupService,
  ReservationHoldCleanupServiceLive,
} from "@/features/checkout/backend/reservation-hold-cleanup.service";
import {
  type WebhookEventIdentity,
  WebhookEventRepository,
  WebhookEventRepositoryLive,
} from "@/features/checkout/backend/webhook-event.repository";
import { DotyposRuntimeConfigLive } from "@/shared/backend/config/dotypos.config";

const toNexiAmount = Schema.encode(NexiAmountFromWorkspaceMoney);

type NexiWebhookFailureCode =
  | "nexi_webhook_parse_failed"
  | "nexi_webhook_unknown_order"
  | "nexi_webhook_missing_security_token"
  | "nexi_webhook_expected_amount_invalid"
  | "nexi_webhook_verification_failed"
  | "nexi_webhook_verification_mismatch"
  | "nexi_webhook_transition_failed"
  | "nexi_webhook_fulfillment_failed";

export class NexiWebhookProcessingError extends Data.TaggedError(
  "NexiWebhookProcessingError"
)<{
  readonly errorCode: NexiWebhookFailureCode;
  readonly eventId?: string;
  readonly orderId?: string;
  readonly message: string;
  readonly cause?: unknown;
}> {}

export interface NexiWebhookResult {
  readonly status: "accepted" | "duplicate";
  readonly orderId?: string;
  readonly eventId?: string;
}

export interface NexiWebhookService {
  readonly processNotification: (
    payload: unknown
  ) => Effect.Effect<NexiWebhookResult, NexiWebhookProcessingError>;
}

export const NexiWebhookService =
  Context.GenericTag<NexiWebhookService>("NexiWebhookService");

const toWebhookProcessingError =
  (input: {
    readonly errorCode: NexiWebhookFailureCode;
    readonly eventId?: string;
    readonly orderId?: string;
    readonly message: string;
  }) =>
  (cause: unknown) =>
    new NexiWebhookProcessingError({
      ...input,
      cause,
    });

const markEventFailed = (
  webhookEvents: WebhookEventRepository,
  identity: WebhookEventIdentity,
  errorCode: NexiWebhookFailureCode
) => webhookEvents.markFailed({ ...identity, errorCode }).pipe(Effect.ignore);

const failAfterMarkingEvent = (
  webhookEvents: WebhookEventRepository,
  identity: WebhookEventIdentity,
  error: NexiWebhookProcessingError
) =>
  markEventFailed(webhookEvents, identity, error.errorCode).pipe(
    Effect.zipRight(Effect.fail(error))
  );

const loadPaymentOrder: (input: {
  readonly orderId: string;
  readonly eventId: string;
  readonly webhookEvents: WebhookEventRepository;
  readonly paymentOrders: PaymentOrderRepository;
}) => Effect.Effect<PaymentOrder, NexiWebhookProcessingError> = Effect.fn(
  "nexiWebhook.loadPaymentOrder"
)(
  function* (input) {
    const order = yield* input.paymentOrders.findById(input.orderId).pipe(
      Effect.mapError(
        (cause) =>
          new NexiWebhookProcessingError({
            errorCode: "nexi_webhook_unknown_order",
            eventId: input.eventId,
            orderId: input.orderId,
            message: "Payment order could not be loaded for Nexi webhook.",
            cause,
          })
      )
    );

    if (!order) {
      return yield* failAfterMarkingEvent(
        input.webhookEvents,
        { type: "eventId", eventId: input.eventId },
        new NexiWebhookProcessingError({
          errorCode: "nexi_webhook_unknown_order",
          eventId: input.eventId,
          orderId: input.orderId,
          message: "Nexi webhook referenced an unknown payment order.",
        })
      );
    }

    return order;
  },
  (effect, input) => effect.pipe(Effect.annotateLogs(input))
);

const getExpectedNexiAmount: (input: {
  readonly order: PaymentOrder;
  readonly eventId: string;
  readonly webhookEvents: WebhookEventRepository;
}) => Effect.Effect<
  { readonly amount: string; readonly currency: NexiCurrency },
  NexiWebhookProcessingError
> = Effect.fn("nexiWebhook.getExpectedNexiAmount")(
  function* (input) {
    return yield* toNexiAmount(
      input.order.checkoutDetails.payment.expectedPrice
    );
  },
  (effect, input) =>
    effect.pipe(
      Effect.mapError(
        (cause) =>
          new NexiWebhookProcessingError({
            errorCode: "nexi_webhook_expected_amount_invalid",
            eventId: input.eventId,
            orderId: input.order.id,
            message:
              "Payment order expected amount could not be encoded for Nexi verification.",
            cause,
          })
      ),
      Effect.catchAll((error) =>
        failAfterMarkingEvent(
          input.webhookEvents,
          { type: "eventId", eventId: input.eventId },
          error
        )
      ),
      Effect.annotateLogs(input)
    )
);

const failOnSecurityTokenMismatch: (input: {
  readonly order: PaymentOrder;
  readonly eventId: string;
  readonly notificationSecurityToken: string | undefined;
  readonly webhookEvents: WebhookEventRepository;
}) => Effect.Effect<void, NexiWebhookProcessingError> = Effect.fn(
  "nexiWebhook.failOnSecurityTokenMismatch"
)(
  function* (input) {
    const tokenCheck = checkNexiWebhookSecurityToken({
      notificationSecurityToken: input.notificationSecurityToken,
      expectedSecurityToken: input.order.securityToken,
    });
    if (tokenCheck.status !== "mismatch") return;

    return yield* failAfterMarkingEvent(
      input.webhookEvents,
      { type: "eventId", eventId: input.eventId },
      new NexiWebhookProcessingError({
        errorCode: "nexi_webhook_verification_mismatch",
        eventId: input.eventId,
        orderId: input.order.id,
        message: "Nexi webhook security token did not match the stored token.",
      })
    );
  },
  (effect, input) => effect.pipe(Effect.annotateLogs(input))
);

const verifyPayment: (input: {
  readonly order: PaymentOrder;
  readonly eventId: string;
  readonly webhookEvents: WebhookEventRepository;
  readonly nexi: NexiService;
}) => Effect.Effect<PaymentVerificationResult, NexiWebhookProcessingError> =
  Effect.fn("nexiWebhook.verifyPayment")(
    function* (input) {
      if (!input.order.securityToken) {
        return yield* failAfterMarkingEvent(
          input.webhookEvents,
          { type: "eventId", eventId: input.eventId },
          new NexiWebhookProcessingError({
            errorCode: "nexi_webhook_missing_security_token",
            eventId: input.eventId,
            orderId: input.order.id,
            message: "Payment order has no stored Nexi security token.",
          })
        );
      }

      const expectedAmount = yield* getExpectedNexiAmount(input);

      return yield* input.nexi
        .verifyPaymentOutcome({
          orderId: input.order.id,
          correlationId: input.order.correlationId,
          amount: expectedAmount.amount,
          currency: expectedAmount.currency,
          securityToken: input.order.securityToken,
        })
        .pipe(
          Effect.mapError(
            (cause) =>
              new NexiWebhookProcessingError({
                errorCode: "nexi_webhook_verification_failed",
                eventId: input.eventId,
                orderId: input.order.id,
                message: "Nexi provider verification failed.",
                cause,
              })
          ),
          Effect.catchAll((error) =>
            failAfterMarkingEvent(
              input.webhookEvents,
              { type: "eventId", eventId: input.eventId },
              error
            )
          )
        );
    },
    (effect, input) => effect.pipe(Effect.annotateLogs(input))
  );

const failOnVerificationMismatch: (input: {
  readonly order: PaymentOrder;
  readonly eventId: string;
  readonly verification: PaymentVerificationResult;
  readonly webhookEvents: WebhookEventRepository;
}) => Effect.Effect<void, NexiWebhookProcessingError> = Effect.fn(
  "nexiWebhook.failOnVerificationMismatch"
)(
  function* (input) {
    if (input.verification.mismatches.length === 0) return;

    return yield* failAfterMarkingEvent(
      input.webhookEvents,
      { type: "eventId", eventId: input.eventId },
      new NexiWebhookProcessingError({
        errorCode: "nexi_webhook_verification_mismatch",
        eventId: input.eventId,
        orderId: input.order.id,
        message: "Nexi payment verification returned local fact mismatches.",
      })
    );
  },
  (effect, input) => effect.pipe(Effect.annotateLogs(input))
);

const markVerifiedPayment: (input: {
  readonly order: PaymentOrder;
  readonly eventId: string;
  readonly verification: PaymentVerificationResult;
  readonly paymentOrders: PaymentOrderRepository;
  readonly holdCleanup: ReservationHoldCleanupService;
  readonly fulfillment: WorkspacePaidFulfillmentService;
}) => Effect.Effect<void, NexiWebhookProcessingError> = Effect.fn(
  "nexiWebhook.markVerifiedPayment"
)(
  function* (input) {
    const orderId = input.order.id;
    const { providerOperationId, providerStatus } = getNexiPaymentMetadata(
      input.verification
    );

    if (input.verification.status === "success") {
      if (input.order.paymentStatus !== "paid") {
        yield* input.paymentOrders
          .markPaid({
            id: orderId,
            providerOperationId,
            providerStatus,
            webhookEventId: input.eventId,
            paidAt: new Date(),
          })
          .pipe(
            Effect.mapError(
              toWebhookProcessingError({
                errorCode: "nexi_webhook_transition_failed",
                eventId: input.eventId,
                orderId,
                message: "Verified Nexi payment could not be marked paid.",
              })
            )
          );
      }

      yield* input.fulfillment.fulfillPaidOrder({ orderId }).pipe(
        Effect.mapError(
          toWebhookProcessingError({
            errorCode: "nexi_webhook_fulfillment_failed",
            eventId: input.eventId,
            orderId,
            message: "Paid workspace order fulfillment failed.",
          })
        )
      );
      return;
    }

    if (input.verification.status === "failure") {
      const failureKind = classifyNexiFailureStatus(providerStatus);
      const markTerminal =
        failureKind === "cancelled"
          ? input.paymentOrders.markCancelled
          : failureKind === "expired"
            ? input.paymentOrders.markExpired
            : input.paymentOrders.markFailed;

      if (
        ["payment_failed", "cancelled", "expired"].includes(
          input.order.paymentStatus
        )
      ) {
        return;
      }

      yield* markTerminal({
        id: orderId,
        failureCode: "nexi_payment_failed",
        providerOperationId,
        providerStatus,
        webhookEventId: input.eventId,
      }).pipe(
        Effect.mapError(
          toWebhookProcessingError({
            errorCode: "nexi_webhook_transition_failed",
            eventId: input.eventId,
            orderId,
            message: "Failed Nexi payment could not be recorded locally.",
          })
        )
      );

      yield* input.holdCleanup.cancelOrderHold({ orderId }).pipe(
        Effect.catchAll((cause) =>
          Effect.logError(
            "Failed to cancel reservation hold after terminal payment",
            { orderId, cause }
          )
        )
      );
    }

    // Pending is a verified no-op state: Nexi can retry/send later updates,
    // while this specific notification has been safely deduped and handled.
  },
  (effect, input) => effect.pipe(Effect.annotateLogs(input))
);

export const NexiWebhookServiceLive = Layer.effect(
  NexiWebhookService,
  Effect.gen(function* () {
    const webhookEvents = yield* WebhookEventRepository;
    const paymentOrders = yield* PaymentOrderRepository;
    const holdCleanup = yield* ReservationHoldCleanupService;
    const nexi = yield* NexiService;
    const fulfillment = yield* WorkspacePaidFulfillmentService;

    return NexiWebhookService.of({
      processNotification: Effect.fn("nexiWebhook.processNotification")(
        function* (payload) {
          const envelope = yield* decodeNexiWebhookNotification(payload).pipe(
            Effect.mapError(
              (cause) =>
                new NexiWebhookProcessingError({
                  errorCode: "nexi_webhook_parse_failed",
                  message: "Nexi webhook notification payload was invalid.",
                  cause,
                })
            )
          );
          const operation = envelope.operation;
          const orderId = operation.orderId;
          const { eventId } = deriveNexiWebhookEventIdentity(envelope);

          const received = yield* webhookEvents
            .insertReceived({
              id: randomUUID(),
              eventId,
              paymentOrderId: orderId,
              receivedAt: new Date(),
            })
            .pipe(
              Effect.mapError(
                toWebhookProcessingError({
                  errorCode: "nexi_webhook_parse_failed",
                  eventId,
                  orderId,
                  message: "Nexi webhook event could not be recorded.",
                })
              )
            );

          if (received.status === "duplicate") {
            yield* Effect.logInfo("Duplicate Nexi webhook ignored", {
              eventId,
              orderId,
            });
            return { status: "duplicate", eventId, orderId } as const;
          }

          const order = yield* loadPaymentOrder({
            orderId,
            eventId,
            webhookEvents,
            paymentOrders,
          });
          yield* failOnSecurityTokenMismatch({
            order,
            eventId,
            notificationSecurityToken: envelope.securityToken,
            webhookEvents,
          });
          const verification = yield* verifyPayment({
            order,
            eventId,
            webhookEvents,
            nexi,
          });

          yield* failOnVerificationMismatch({
            order,
            eventId,
            verification,
            webhookEvents,
          });

          yield* markVerifiedPayment({
            order,
            eventId,
            verification,
            paymentOrders,
            holdCleanup,
            fulfillment,
          }).pipe(
            Effect.catchAll((error) =>
              failAfterMarkingEvent(
                webhookEvents,
                { type: "eventId", eventId },
                error
              )
            )
          );

          yield* webhookEvents
            .markProcessed({
              type: "eventId",
              eventId,
              processedAt: new Date(),
            })
            .pipe(
              Effect.mapError(
                toWebhookProcessingError({
                  errorCode: "nexi_webhook_transition_failed",
                  eventId,
                  orderId,
                  message: "Nexi webhook event could not be marked processed.",
                })
              )
            );

          return { status: "accepted", eventId, orderId } as const;
        },
        (effect) => effect.pipe(Effect.annotateLogs({ provider: "nexi" }))
      ),
    });
  })
);

export const NexiWebhookServiceLiveWithDependencies =
  NexiWebhookServiceLive.pipe(
    Layer.provide(WebhookEventRepositoryLive),
    Layer.provide(ReservationHoldCleanupServiceLive),
    Layer.provide(PaymentOrderRepositoryLive),
    Layer.provide(WorkspaceDatabaseLive),
    Layer.provide(
      Layer.provide(DotyposService.Default, DotyposRuntimeConfigLive)
    ),
    Layer.provide(WorkspacePaidFulfillmentServiceLiveWithDependencies)
  );
