import { randomUUID } from "node:crypto";
import { DotyposService } from "@deskohub/dotypos";
import {
  checkNexiWebhookSecurityToken,
  classifyNexiFailureStatus,
  decodeNexiWebhookNotification,
  deriveNexiWebhookEventIdentity,
  getNexiPaymentMetadata,
  NexiCurrencySchema,
  NexiService,
  type PaymentVerificationResult,
} from "@deskohub/nexi";
import { Context, Data, Effect, Layer, Schema } from "effect";
import { WorkspaceDatabaseLive } from "@/db/database.service";
import { OperationalEventRepositoryLive } from "@/features/checkout/backend/operational-event.repository";
import {
  WorkspacePaidFulfillmentService,
  WorkspacePaidFulfillmentServiceLiveWithDependencies,
} from "@/features/checkout/backend/paid-fulfillment.service";
import {
  PaymentAttemptRepository,
  PaymentAttemptRepositoryLive,
} from "@/features/checkout/backend/payment-attempt.repository";
import {
  ReservationHoldCleanupService,
  ReservationHoldCleanupServiceLiveWithDependencies,
} from "@/features/checkout/backend/reservation-hold-cleanup.service";
import {
  type WebhookEventIdentity,
  WebhookEventRepository,
  WebhookEventRepositoryLive,
} from "@/features/checkout/backend/webhook-event.repository";
import {
  WorkspaceReservationRepository,
  WorkspaceReservationRepositoryLive,
} from "@/features/checkout/backend/workspace-reservation.repository";
import { DotyposRuntimeConfigLive } from "@/shared/backend/config/dotypos.config";

type NexiWebhookFailureCode =
  | "nexi_webhook_parse_failed"
  | "nexi_webhook_unknown_order"
  | "nexi_webhook_missing_security_token"
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
    new NexiWebhookProcessingError({ ...input, cause });

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

const failOnVerificationMismatch = (input: {
  readonly eventId: string;
  readonly orderId: string;
  readonly verification: PaymentVerificationResult;
  readonly webhookEvents: WebhookEventRepository;
}) =>
  input.verification.mismatches.length === 0
    ? Effect.void
    : failAfterMarkingEvent(
        input.webhookEvents,
        { type: "eventId", eventId: input.eventId },
        new NexiWebhookProcessingError({
          errorCode: "nexi_webhook_verification_mismatch",
          eventId: input.eventId,
          orderId: input.orderId,
          message: "Nexi payment verification returned local fact mismatches.",
        })
      );

export const NexiWebhookServiceLive = Layer.effect(
  NexiWebhookService,
  Effect.gen(function* () {
    const webhookEvents = yield* WebhookEventRepository;
    const paymentAttempts = yield* PaymentAttemptRepository;
    const reservations = yield* WorkspaceReservationRepository;
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
          const providerOrderId = operation.orderId;
          const { eventId } = deriveNexiWebhookEventIdentity(envelope);

          const received = yield* webhookEvents
            .insertReceived({
              id: randomUUID(),
              eventId,
              providerOrderId,
              receivedAt: new Date(),
            })
            .pipe(
              Effect.mapError(
                toWebhookProcessingError({
                  errorCode: "nexi_webhook_parse_failed",
                  eventId,
                  orderId: providerOrderId,
                  message: "Nexi webhook event could not be recorded.",
                })
              )
            );

          if (received.status === "duplicate") {
            if (received.event.state === "processed") {
              yield* Effect.logInfo("Processed duplicate Nexi webhook ignored", {
                eventId,
                providerOrderId,
              });
              return {
                status: "duplicate" as const,
                eventId,
                orderId: providerOrderId,
              };
            }

            const retryClaim = yield* webhookEvents.claimRetry({
              type: "eventId",
              eventId,
            });
            if (retryClaim === "processed") {
              yield* Effect.logInfo(
                "Concurrent duplicate Nexi webhook already processed",
                {
                  eventId,
                  providerOrderId,
                }
              );
              return {
                status: "duplicate" as const,
                eventId,
                orderId: providerOrderId,
              };
            }

            yield* Effect.logInfo("Retrying unprocessed duplicate Nexi webhook", {
              eventId,
              providerOrderId,
              previousState: received.event.state,
            });
          }

          const attempt = yield* paymentAttempts
            .findByProviderOrderId(providerOrderId)
            .pipe(
              Effect.mapError(
                toWebhookProcessingError({
                  errorCode: "nexi_webhook_unknown_order",
                  eventId,
                  orderId: providerOrderId,
                  message:
                    "Payment attempt could not be loaded for Nexi webhook.",
                })
              )
            );

          if (!attempt) {
            return yield* failAfterMarkingEvent(
              webhookEvents,
              { type: "eventId", eventId },
              new NexiWebhookProcessingError({
                errorCode: "nexi_webhook_unknown_order",
                eventId,
                orderId: providerOrderId,
                message: "Nexi webhook referenced an unknown payment attempt.",
              })
            );
          }

          yield* webhookEvents
            .linkPaymentAttempt({
              type: "eventId",
              eventId,
              paymentAttemptId: attempt.id,
            })
            .pipe(Effect.ignore);

          const reservation = yield* reservations
            .findById(attempt.workspaceReservationId)
            .pipe(
              Effect.mapError(
                toWebhookProcessingError({
                  errorCode: "nexi_webhook_unknown_order",
                  eventId,
                  orderId: providerOrderId,
                  message:
                    "Workspace reservation could not be loaded for Nexi webhook.",
                })
              )
            );

          if (!reservation) {
            return yield* failAfterMarkingEvent(
              webhookEvents,
              { type: "eventId", eventId },
              new NexiWebhookProcessingError({
                errorCode: "nexi_webhook_unknown_order",
                eventId,
                orderId: providerOrderId,
                message:
                  "Nexi webhook referenced an unknown workspace reservation.",
              })
            );
          }

          const tokenCheck = checkNexiWebhookSecurityToken({
            notificationSecurityToken: envelope.securityToken,
            expectedSecurityToken: attempt.securityToken,
          });
          if (tokenCheck.status === "mismatch") {
            return yield* failAfterMarkingEvent(
              webhookEvents,
              { type: "eventId", eventId },
              new NexiWebhookProcessingError({
                errorCode: "nexi_webhook_verification_mismatch",
                eventId,
                orderId: providerOrderId,
                message: "Nexi webhook security token did not match.",
              })
            );
          }

          if (!attempt.securityToken) {
            return yield* failAfterMarkingEvent(
              webhookEvents,
              { type: "eventId", eventId },
              new NexiWebhookProcessingError({
                errorCode: "nexi_webhook_missing_security_token",
                eventId,
                orderId: providerOrderId,
                message: "Payment attempt has no stored Nexi security token.",
              })
            );
          }

          const currency = yield* Schema.decodeUnknown(NexiCurrencySchema)(
            attempt.currency
          ).pipe(Effect.orDie);
          const verification = yield* nexi
            .verifyPaymentOutcome({
              orderId: attempt.providerOrderId,
              correlationId: reservation.correlationId,
              amount: String(attempt.amountValue),
              currency,
              securityToken: attempt.securityToken,
            })
            .pipe(
              Effect.mapError(
                toWebhookProcessingError({
                  errorCode: "nexi_webhook_verification_failed",
                  eventId,
                  orderId: providerOrderId,
                  message: "Nexi provider verification failed.",
                })
              ),
              Effect.catchAll((error) =>
                failAfterMarkingEvent(
                  webhookEvents,
                  { type: "eventId", eventId },
                  error
                )
              )
            );

          yield* failOnVerificationMismatch({
            eventId,
            orderId: providerOrderId,
            verification,
            webhookEvents,
          });

          const { providerOperationId, providerStatus } =
            getNexiPaymentMetadata(verification);

          if (verification.status === "success") {
            yield* paymentAttempts.markPaidForReservation({
              id: attempt.id,
              workspaceReservationId: reservation.id,
              webhookEventId: eventId,
              providerOperationId,
              providerStatus,
              paidAt: new Date(),
            });
            yield* fulfillment
              .fulfillPaidOrder({ orderId: reservation.id })
              .pipe(
                Effect.mapError(
                  toWebhookProcessingError({
                    errorCode: "nexi_webhook_fulfillment_failed",
                    eventId,
                    orderId: providerOrderId,
                    message: "Paid workspace reservation fulfillment failed.",
                  })
                ),
                Effect.catchAll((error) =>
                  failAfterMarkingEvent(
                    webhookEvents,
                    { type: "eventId", eventId },
                    error
                  )
                )
              );
          } else if (verification.status === "failure") {
            const failureKind = classifyNexiFailureStatus(providerStatus);
            const terminalState =
              failureKind === "cancelled"
                ? "cancelled"
                : failureKind === "expired"
                  ? "expired"
                  : "failed";

            yield* paymentAttempts.markTerminalForReservation({
              id: attempt.id,
              workspaceReservationId: reservation.id,
              state: terminalState,
              failureCode: "nexi_payment_failed",
              webhookEventId: eventId,
              providerOperationId,
              providerStatus,
            });
            yield* holdCleanup
              .cancelOrderHold({ orderId: reservation.id })
              .pipe(Effect.ignore);
          }

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
                  orderId: providerOrderId,
                  message: "Nexi webhook event could not be marked processed.",
                })
              )
            );

          return {
            status: "accepted" as const,
            eventId,
            orderId: providerOrderId,
          };
        },
        (effect) =>
          effect.pipe(
            Effect.mapError((cause) =>
              cause instanceof NexiWebhookProcessingError
                ? cause
                : new NexiWebhookProcessingError({
                    errorCode: "nexi_webhook_transition_failed",
                    message: "Nexi webhook processing failed.",
                    cause,
                  })
            ),
            Effect.annotateLogs({ provider: "nexi" })
          )
      ),
    });
  })
);

export const NexiWebhookServiceLiveWithDependencies =
  NexiWebhookServiceLive.pipe(
    Layer.provide(WebhookEventRepositoryLive),
    Layer.provide(ReservationHoldCleanupServiceLiveWithDependencies),
    Layer.provide(OperationalEventRepositoryLive),
    Layer.provide(PaymentAttemptRepositoryLive),
    Layer.provide(WorkspaceReservationRepositoryLive),
    Layer.provide(WorkspaceDatabaseLive),
    Layer.provide(
      Layer.provide(DotyposService.Default, DotyposRuntimeConfigLive)
    ),
    Layer.provide(WorkspacePaidFulfillmentServiceLiveWithDependencies)
  );
