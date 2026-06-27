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
import { Context, Data, Effect, Layer, Predicate, Schema } from "effect";
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
  capturePaymentAbandoned,
  capturePaymentCompleted,
  capturePaymentFailed,
} from "@/features/checkout/backend/posthog-lifecycle-events";
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
} from "@/features/reservation/backend/workspace-reservation.repository";
import {
  PostHogEventService,
  PostHogEventServiceLive,
} from "@/shared/backend/analytics/posthog-event.service";

type NexiWebhookFailureCode =
  | "nexi_webhook_parse_failed"
  | "nexi_webhook_unknown_order"
  | "nexi_webhook_missing_security_token"
  | "nexi_webhook_invalid_currency"
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
  Context.Service<NexiWebhookService>("NexiWebhookService");

const markEventFailed = (
  webhookEvents: WebhookEventRepository,
  identity: WebhookEventIdentity,
  errorCode: NexiWebhookFailureCode
) =>
  webhookEvents.markFailed({ ...identity, errorCode }).pipe(
    Effect.tapError((cause) =>
      Effect.logError("Nexi webhook failed-state marker failed", {
        identity,
        errorCode,
        cause,
      })
    ),
    Effect.ignore
  );

const failAfterMarkingEvent = (
  webhookEvents: WebhookEventRepository,
  identity: WebhookEventIdentity,
  error: NexiWebhookProcessingError
) =>
  markEventFailed(webhookEvents, identity, error.errorCode).pipe(
    Effect.andThen(Effect.fail(error))
  );

const failOnVerificationMismatch = Effect.fn(
  function* (input: {
    readonly eventId: string;
    readonly orderId: string;
    readonly verification: PaymentVerificationResult;
    readonly webhookEvents: WebhookEventRepository;
  }) {
    if (input.verification.mismatches.length === 0) return;
    yield* Effect.logWarning("Nexi webhook verification mismatch detected", {
      verification: input.verification,
    });

    yield* failAfterMarkingEvent(
      input.webhookEvents,
      { type: "eventId", eventId: input.eventId },
      new NexiWebhookProcessingError({
        errorCode: "nexi_webhook_verification_mismatch",
        eventId: input.eventId,
        orderId: input.orderId,
        message: "Nexi payment verification returned local fact mismatches.",
      })
    );
  },
  (effect, input) => effect.pipe(Effect.annotateLogs({ ...input }))
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
    const posthogEvents = yield* PostHogEventService;

    return NexiWebhookService.of({
      processNotification: Effect.fn("nexiWebhook.processNotification")(
        function* (payload) {
          yield* Effect.annotateLogsScoped({ payload });
          yield* Effect.logInfo("Nexi webhook processing started");

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
          const providerOrderId = envelope.operation.orderId;
          const { eventId } = deriveNexiWebhookEventIdentity(envelope);
          yield* Effect.annotateLogsScoped({
            envelope,
            eventId,
            providerOrderId,
          });
          yield* Effect.logInfo("Nexi webhook notification decoded");

          const received = yield* webhookEvents
            .insertReceived({
              eventId,
              providerOrderId,
              receivedAt: new Date(),
            })
            .pipe(
              Effect.mapError(
                (cause) =>
                  new NexiWebhookProcessingError({
                    errorCode: "nexi_webhook_transition_failed",
                    eventId,
                    orderId: providerOrderId,
                    message: "Nexi webhook event could not be recorded.",
                    cause,
                  })
              )
            );
          yield* Effect.annotateLogsScoped({ received });
          yield* Effect.logInfo("Nexi webhook event recorded");

          if (received.status === "duplicate") {
            if (received.event.state === "processed") {
              yield* Effect.logInfo(
                "Processed duplicate Nexi webhook ignored",
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

            const retryClaim = yield* webhookEvents.claimRetry({
              type: "eventId",
              eventId,
            });
            yield* Effect.annotateLogsScoped({ retryClaim });
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

            yield* Effect.logWarning(
              "Retrying unprocessed duplicate Nexi webhook",
              {
                eventId,
                providerOrderId,
                previousState: received.event.state,
              }
            );
          }

          const attempt = yield* paymentAttempts
            .findByProviderOrderId(providerOrderId)
            .pipe(
              Effect.mapError(
                (cause) =>
                  new NexiWebhookProcessingError({
                    errorCode: "nexi_webhook_unknown_order",
                    eventId,
                    orderId: providerOrderId,
                    message:
                      "Payment attempt could not be loaded for Nexi webhook.",
                    cause,
                  })
              )
            );
          yield* Effect.annotateLogsScoped({ attempt });
          yield* Effect.logDebug(
            "Nexi webhook payment attempt lookup completed"
          );

          if (!attempt) {
            yield* Effect.logWarning(
              "Nexi webhook referenced unknown payment attempt"
            );

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
          yield* Effect.logInfo("Nexi webhook payment attempt resolved");

          yield* webhookEvents
            .linkPaymentAttempt({
              type: "eventId",
              eventId,
              paymentAttemptId: attempt.id,
            })
            .pipe(
              Effect.tapError((cause) =>
                Effect.logWarning("Nexi webhook payment attempt link failed", {
                  eventId,
                  paymentAttemptId: attempt.id,
                  providerOrderId,
                  cause,
                })
              ),
              Effect.ignore
            );
          yield* Effect.logDebug("Nexi webhook payment attempt link completed");

          const reservation = yield* reservations
            .findById(attempt.workspaceReservationId)
            .pipe(
              Effect.mapError(
                (cause) =>
                  new NexiWebhookProcessingError({
                    errorCode: "nexi_webhook_unknown_order",
                    eventId,
                    orderId: providerOrderId,
                    message:
                      "Workspace reservation could not be loaded for Nexi webhook.",
                    cause,
                  })
              )
            );
          yield* Effect.annotateLogsScoped({ reservation });
          yield* Effect.logDebug(
            "Nexi webhook workspace reservation lookup completed"
          );

          if (!reservation) {
            yield* Effect.logWarning(
              "Nexi webhook referenced unknown workspace reservation"
            );

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
          yield* Effect.logInfo("Nexi webhook workspace reservation resolved");

          const tokenCheck = checkNexiWebhookSecurityToken({
            notificationSecurityToken: envelope.securityToken,
            expectedSecurityToken: attempt.securityToken,
          });
          yield* Effect.annotateLogsScoped({ tokenCheck });
          yield* Effect.logDebug("Nexi webhook security token checked");
          if (tokenCheck.status === "mismatch") {
            yield* Effect.logWarning(
              "Nexi webhook security token mismatch detected"
            );

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
            yield* Effect.logWarning(
              "Nexi webhook payment attempt is missing security token"
            );

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

          const currency = yield* Schema.decodeUnknownEffect(
            NexiCurrencySchema
          )(attempt.currency).pipe(
            Effect.mapError(
              (cause) =>
                new NexiWebhookProcessingError({
                  errorCode: "nexi_webhook_invalid_currency",
                  eventId,
                  orderId: providerOrderId,
                  message: "Payment attempt has an invalid Nexi currency.",
                  cause,
                })
            ),
            Effect.catch((error) =>
              failAfterMarkingEvent(
                webhookEvents,
                { type: "eventId", eventId },
                error
              )
            )
          );
          yield* Effect.annotateLogsScoped({ currency });
          yield* Effect.logDebug("Nexi webhook currency decoded");

          const verificationInput = {
            orderId: attempt.providerOrderId,
            correlationId: reservation.correlationId,
            amount: String(attempt.amountValue),
            currency,
            securityToken: attempt.securityToken,
          };
          yield* Effect.annotateLogsScoped({ verificationInput });
          yield* Effect.logInfo("Nexi webhook payment verification started");

          const verification = yield* nexi
            .verifyPaymentOutcome(verificationInput)
            .pipe(
              Effect.mapError(
                (cause) =>
                  new NexiWebhookProcessingError({
                    errorCode: "nexi_webhook_verification_failed",
                    eventId,
                    orderId: providerOrderId,
                    message: "Nexi provider verification failed.",
                    cause,
                  })
              ),
              Effect.catch((error) =>
                failAfterMarkingEvent(
                  webhookEvents,
                  { type: "eventId", eventId },
                  error
                )
              )
            );
          yield* Effect.annotateLogsScoped({ verification });
          yield* Effect.logInfo("Nexi webhook payment verification completed");

          yield* failOnVerificationMismatch({
            eventId,
            orderId: providerOrderId,
            verification,
            webhookEvents,
          });

          const providerMetadata = getNexiPaymentMetadata(verification);
          const { providerOperationId, providerStatus } = providerMetadata;
          yield* Effect.annotateLogsScoped({ providerMetadata });
          yield* Effect.logDebug("Nexi webhook provider metadata resolved");

          if (verification.status === "success") {
            yield* Effect.logInfo("Nexi webhook paid transition started");

            const transition = yield* paymentAttempts.markPaidForReservation({
              id: attempt.id,
              workspaceReservationId: reservation.id,
              webhookEventId: eventId,
              providerOperationId,
              providerStatus,
              paidAt: new Date(),
            });
            if (transition.changed) {
              yield* capturePaymentCompleted({
                attempt: transition.attempt,
                timestamp: transition.timestamp,
              }).pipe(
                Effect.provideService(PostHogEventService, posthogEvents)
              );
            }
            yield* Effect.logInfo("Nexi webhook payment attempt marked paid");

            yield* fulfillment
              .fulfillPaidOrder({ orderId: reservation.id })
              .pipe(
                Effect.mapError(
                  (cause) =>
                    new NexiWebhookProcessingError({
                      errorCode: "nexi_webhook_fulfillment_failed",
                      eventId,
                      orderId: providerOrderId,
                      message: "Paid workspace reservation fulfillment failed.",
                      cause,
                    })
                ),
                Effect.catch((error) =>
                  failAfterMarkingEvent(
                    webhookEvents,
                    { type: "eventId", eventId },
                    error
                  )
                )
              );
            yield* Effect.logInfo("Nexi webhook paid order fulfilled");
          } else if (verification.status === "failure") {
            const failureKind = classifyNexiFailureStatus(providerStatus);
            const terminalState = failureKind;
            yield* Effect.annotateLogsScoped({ failureKind, terminalState });
            yield* Effect.logInfo("Nexi webhook terminal transition started");

            const transition =
              yield* paymentAttempts.markTerminalForReservation({
                id: attempt.id,
                workspaceReservationId: reservation.id,
                state: terminalState,
                failureCode: "nexi_payment_failed",
                webhookEventId: eventId,
                providerOperationId,
                providerStatus,
              });
            if (transition.changed) {
              if (terminalState === "failed") {
                yield* capturePaymentFailed({
                  attempt: transition.attempt,
                  failureCode:
                    transition.attempt.lastProviderStatus ??
                    transition.attempt.failureCode ??
                    "nexi_payment_failed",
                  failureReason: "nexi_payment_failed",
                  timestamp: transition.timestamp,
                }).pipe(
                  Effect.provideService(PostHogEventService, posthogEvents)
                );
              } else {
                yield* capturePaymentAbandoned({
                  attempt: transition.attempt,
                  timestamp: transition.timestamp,
                }).pipe(
                  Effect.provideService(PostHogEventService, posthogEvents)
                );
              }
            }
            yield* Effect.logInfo(
              "Nexi webhook payment attempt marked terminal"
            );

            yield* holdCleanup
              .cancelOrderHold({ orderId: reservation.id })
              .pipe(
                Effect.tapError((cause) =>
                  Effect.logWarning(
                    "Nexi webhook terminal hold cleanup failed",
                    {
                      eventId,
                      orderId: reservation.id,
                      providerOrderId,
                      cause,
                    }
                  )
                ),
                Effect.ignore
              );
            yield* Effect.logInfo(
              "Nexi webhook terminal hold cleanup attempted"
            );
          } else {
            yield* Effect.logInfo(
              "Nexi webhook verification did not require payment transition"
            );
          }

          yield* webhookEvents
            .markProcessed({
              type: "eventId",
              eventId,
              processedAt: new Date(),
            })
            .pipe(
              Effect.mapError(
                (cause) =>
                  new NexiWebhookProcessingError({
                    errorCode: "nexi_webhook_transition_failed",
                    eventId,
                    orderId: providerOrderId,
                    message:
                      "Nexi webhook event could not be marked processed.",
                    cause,
                  })
              )
            );
          yield* Effect.logInfo("Nexi webhook event marked processed");

          const result = {
            status: "accepted" as const,
            eventId,
            orderId: providerOrderId,
          };
          yield* Effect.annotateLogsScoped({ result });
          yield* Effect.logInfo("Nexi webhook processing accepted");

          return result;
        },
        (effect) =>
          effect.pipe(
            Effect.scoped,
            Effect.mapError((cause) =>
              Predicate.isTagged(cause, "NexiWebhookProcessingError")
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
    Layer.provide(PaymentAttemptRepositoryLive),
    Layer.provide(PostHogEventServiceLive),
    Layer.provide(WorkspaceReservationRepositoryLive),
    Layer.provide(WorkspaceDatabaseLive),
    Layer.provide(WorkspacePaidFulfillmentServiceLiveWithDependencies)
  );
