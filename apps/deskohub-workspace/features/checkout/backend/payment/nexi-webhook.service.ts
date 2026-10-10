import {
  checkNexiWebhookSecurityToken,
  classifyNexiFailureStatus,
  decodeNexiWebhookNotification,
  deriveNexiWebhookEventIdentity,
  getNexiPaymentMetadata,
  isNexiRefundOperation,
  NexiCurrencySchema,
  type NexiOrderId,
  NexiService,
  type NexiWebhookEventId,
  type PaymentVerificationResult,
} from "@deskohub/nexi";
import { Context, Data, Effect, Layer, Predicate, Schema } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import type { PaymentAttemptState } from "@/db/schema";
import { WorkspaceReservationRepository } from "@/features/reservation/backend/workspace-reservation.repository";
import { PostHogEventService } from "@/shared/backend/analytics/posthog-event.service";
import {
  capturePaymentAbandoned,
  capturePaymentCompleted,
  capturePaymentFailed,
} from "../analytics/posthog-lifecycle-events";
import { WorkspacePaidFulfillmentService } from "../fulfillment/paid-fulfillment.service";
import { LatePaymentRecoveryRepository } from "../repositories/late-payment-recovery.repository";
import {
  isNexiPaymentAttempt,
  PaymentAttemptRepository,
} from "../repositories/payment-attempt.repository";
import { PaymentLifecycleRepository } from "../repositories/payment-lifecycle.repository";
import { PaymentRefundRepository } from "../repositories/payment-refund.repository";
import {
  type IWebhookEventRepository,
  type WebhookEventIdentity,
  WebhookEventRepository,
} from "../repositories/webhook-event.repository";
import { LatePaymentRecoveryQueueService } from "./late-payment-recovery-queue.service";
import { getNexiCurrencyOverride } from "./nexi-currency";
import { PaymentRefundService } from "./payment-refund.service";

type NexiWebhookFailureCode =
  | "nexi_webhook_parse_failed"
  | "nexi_webhook_unknown_order"
  | "nexi_webhook_missing_security_token"
  | "nexi_webhook_invalid_currency"
  | "nexi_webhook_verification_failed"
  | "nexi_webhook_verification_mismatch"
  | "nexi_webhook_late_payment"
  | "nexi_webhook_late_payment_recovery_failed"
  | "nexi_webhook_refund_reconciliation_failed"
  | "nexi_webhook_transition_failed"
  | "nexi_webhook_fulfillment_failed";

export class NexiWebhookProcessingError extends Data.TaggedError(
  "NexiWebhookProcessingError"
)<{
  readonly errorCode: NexiWebhookFailureCode;
  readonly eventId?: NexiWebhookEventId;
  readonly orderId?: NexiOrderId;
  readonly message: string;
  readonly cause?: unknown;
}> {}

export interface NexiWebhookResult {
  readonly status: "accepted" | "duplicate";
  readonly orderId?: NexiOrderId;
  readonly eventId?: NexiWebhookEventId;
}

export interface INexiWebhookService {
  readonly processNotification: (
    payload: Parameters<typeof decodeNexiWebhookNotification>[0]
  ) => Effect.Effect<NexiWebhookResult, NexiWebhookProcessingError>;
}

export class NexiWebhookService extends Context.Service<
  NexiWebhookService,
  INexiWebhookService
>()("NexiWebhookService") {
  static Default = makeNexiWebhookServiceLayer(this);

  static Live = this.Default.pipe(
    Layer.provide(WebhookEventRepository.Default),
    Layer.provide(PaymentAttemptRepository.Default),
    Layer.provide(PaymentLifecycleRepository.Default),
    Layer.provide(LatePaymentRecoveryRepository.Default),
    Layer.provide(LatePaymentRecoveryQueueService.Default),
    Layer.provide(PostHogEventService.Live),
    Layer.provide(WorkspaceReservationRepository.Default),
    Layer.provide(
      PaymentRefundService.Default.pipe(
        Layer.provide(PaymentRefundRepository.Default)
      )
    ),
    Layer.provide(WorkspaceDatabase.Default),
    Layer.provide(WorkspacePaidFulfillmentService.Live)
  );
}

const markEventFailed = (
  webhookEvents: IWebhookEventRepository,
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
  webhookEvents: IWebhookEventRepository,
  identity: WebhookEventIdentity,
  error: NexiWebhookProcessingError
) =>
  markEventFailed(webhookEvents, identity, error.errorCode).pipe(
    Effect.andThen(Effect.fail(error))
  );

const failOnVerificationMismatch = Effect.fn(
  function* (input: {
    readonly eventId: NexiWebhookEventId;
    readonly orderId: NexiOrderId;
    readonly verification: PaymentVerificationResult;
    readonly webhookEvents: IWebhookEventRepository;
  }) {
    if (input.verification.mismatches.length === 0) return;
    yield* Effect.logWarning("Nexi webhook verification mismatch detected", {
      verification: input.verification,
    });

    return yield* failAfterMarkingEvent(
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

function makeNexiWebhookServiceLayer(service: typeof NexiWebhookService) {
  return Layer.effect(
    service,
    Effect.gen(function* () {
      const webhookEvents = yield* WebhookEventRepository;
      const paymentAttempts = yield* PaymentAttemptRepository;
      const paymentLifecycle = yield* PaymentLifecycleRepository;
      const reservations = yield* WorkspaceReservationRepository;
      const nexi = yield* NexiService;
      const fulfillment = yield* WorkspacePaidFulfillmentService;
      const posthogEvents = yield* PostHogEventService;
      const latePaymentRecoveries = yield* LatePaymentRecoveryRepository;
      const latePaymentRecoveryQueue = yield* LatePaymentRecoveryQueueService;
      const paymentRefunds = yield* PaymentRefundService;

      const acceptEvent = Effect.fn(function* (input: {
        readonly eventId: NexiWebhookEventId;
        readonly providerOrderId: NexiOrderId;
      }) {
        yield* webhookEvents
          .markProcessed({
            type: "eventId",
            eventId: input.eventId,
            processedAt: Temporal.Now.instant(),
          })
          .pipe(
            Effect.mapError(
              (cause) =>
                new NexiWebhookProcessingError({
                  errorCode: "nexi_webhook_transition_failed",
                  eventId: input.eventId,
                  orderId: input.providerOrderId,
                  message: "Nexi webhook event could not be marked processed.",
                  cause,
                })
            )
          );
        yield* Effect.logInfo("Nexi webhook event marked processed");

        const result: NexiWebhookResult = {
          status: "accepted",
          eventId: input.eventId,
          orderId: input.providerOrderId,
        };
        yield* Effect.annotateLogsScoped({ result });
        yield* Effect.logInfo("Nexi webhook processing accepted");

        return result;
      });

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
                receivedAt: Temporal.Now.instant(),
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
                  message:
                    "Nexi webhook referenced an unknown payment attempt.",
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
                  Effect.logWarning(
                    "Nexi webhook payment attempt link failed",
                    {
                      eventId,
                      paymentAttemptId: attempt.id,
                      providerOrderId,
                      cause,
                    }
                  )
                ),
                Effect.ignore
              );
            yield* Effect.logDebug(
              "Nexi webhook payment attempt link completed"
            );

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
            yield* Effect.logInfo(
              "Nexi webhook workspace reservation resolved"
            );

            const tokenCheck = checkNexiWebhookSecurityToken({
              notificationSecurityToken: envelope.securityToken,
              expectedSecurityToken: attempt.securityToken,
            });
            yield* Effect.annotateLogsScoped({ tokenCheck });
            yield* Effect.logDebug("Nexi webhook security token checked");
            // Nexi marks the token optional; a notification without one
            // only triggers the authoritative order lookup below.
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

            if (!isNexiPaymentAttempt(attempt) || !attempt.securityToken) {
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

            // A refund notification reports money going back on an already
            // paid order. It must never re-run the paid transition or
            // fulfillment, so it only records what Nexi's order now shows.
            if (isNexiRefundOperation(envelope.operation)) {
              yield* Effect.logInfo(
                "Nexi webhook refund reconciliation started"
              );
              const refundResult = yield* paymentRefunds
                .reconcileAttempt({
                  attempt,
                  correlationId: reservation.correlationId,
                })
                .pipe(
                  Effect.mapError(
                    (cause) =>
                      new NexiWebhookProcessingError({
                        errorCode: "nexi_webhook_refund_reconciliation_failed",
                        eventId,
                        orderId: providerOrderId,
                        message: "Nexi refund could not be reconciled.",
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
              yield* Effect.annotateLogsScoped({ refundResult });
              yield* Effect.logInfo(
                "Nexi webhook refund reconciliation completed"
              );

              return yield* acceptEvent({ eventId, providerOrderId });
            }

            const currency = yield* Schema.decodeUnknownEffect(
              NexiCurrencySchema
            )(attempt.amount.currency).pipe(
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
              amount: String(attempt.amount.value),
              currency: getNexiCurrencyOverride() ?? currency,
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
            yield* Effect.logInfo(
              "Nexi webhook payment verification completed"
            );

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

            if (
              verification.status === "success" &&
              isTerminalPaymentAttemptState(attempt.state)
            ) {
              yield* Effect.logWarning(
                "Nexi payment settled after the local payment attempt became terminal",
                {
                  eventId,
                  paymentAttemptId: attempt.id,
                  paymentAttemptState: attempt.state,
                  providerOrderId,
                  reservationId: reservation.id,
                }
              );
              yield* latePaymentRecoveries
                .start({
                  paymentAttemptId: attempt.id,
                  workspaceReservationId: reservation.id,
                  webhookEventId: eventId,
                  providerOperationId,
                  providerStatus,
                  verifiedPaidAt: Temporal.Now.instant(),
                })
                .pipe(
                  Effect.andThen(
                    latePaymentRecoveryQueue.enqueue({
                      paymentAttemptId: attempt.id,
                    })
                  ),
                  Effect.mapError(
                    (cause) =>
                      new NexiWebhookProcessingError({
                        errorCode: "nexi_webhook_late_payment_recovery_failed",
                        eventId,
                        orderId: providerOrderId,
                        message:
                          "Nexi late-payment recovery could not be started.",
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
            }

            if (
              verification.status === "success" &&
              !isTerminalPaymentAttemptState(attempt.state)
            ) {
              yield* Effect.logInfo("Nexi webhook paid transition started");

              const transition = yield* paymentLifecycle.markPaid({
                id: attempt.id,
                workspaceReservationId: reservation.id,
                webhookEventId: eventId,
                providerOperationId,
                providerStatus,
                paidAt: Temporal.Now.instant(),
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
                        message:
                          "Paid workspace reservation fulfillment failed.",
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

              // An unsuccessful result moves no money. When the attempt is no
              // longer the active pending attempt (abandonment expiry, or a
              // newer attempt after status reconciliation), the transition
              // can never apply, so accept the event instead of provoking
              // endless provider retries.
              const transition = yield* paymentLifecycle
                .markTerminal({
                  id: attempt.id,
                  workspaceReservationId: reservation.id,
                  state: terminalState,
                  failureCode: "nexi_payment_failed",
                  webhookEventId: eventId,
                  providerOperationId,
                  providerStatus,
                })
                .pipe(
                  Effect.catchTag(
                    "PaymentLifecycleStateError",
                    Effect.fn(function* (cause) {
                      yield* Effect.logWarning(
                        "Nexi webhook terminal transition no longer applies",
                        { cause }
                      );
                      return undefined;
                    })
                  )
                );
              if (transition?.changed) {
                if (terminalState === "failed") {
                  yield* capturePaymentFailed({
                    attempt: transition.attempt,
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
            } else {
              yield* Effect.logInfo(
                "Nexi webhook verification did not require payment transition"
              );
            }

            return yield* acceptEvent({ eventId, providerOrderId });
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
}

const isTerminalPaymentAttemptState = (state: PaymentAttemptState) =>
  state === "failed" || state === "cancelled" || state === "expired";
