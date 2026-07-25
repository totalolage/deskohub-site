import {
  checkNexiWebhookSecurityToken,
  classifyNexiFailureStatus,
  decodeNexiWebhookNotification,
  deriveNexiWebhookEventIdentity,
  getNexiPaymentMetadata,
  isBoundedNexiProviderIdentifier,
  isNexiWebhookEvidenceConsistent,
  NexiCurrencySchema,
  NexiService,
  type PaymentVerificationResult,
} from "@deskohub/nexi";
import { Context, Data, Effect, Layer, Predicate, Schema } from "effect";
import { WorkspaceDatabaseLive } from "@/db/database.service";
import {
  WorkspaceReservationRepository,
  WorkspaceReservationRepositoryLive,
} from "@/features/reservation/backend/workspace-reservation.repository";
import {
  PostHogEventService,
  PostHogEventServiceLive,
} from "@/shared/backend/analytics/posthog-event.service";
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
  isNexiPaymentAttempt,
  PaymentAttemptRepository,
  PaymentAttemptRepositoryLive,
} from "../repositories/payment-attempt.repository";
import { PaymentLifecycleRepository } from "../repositories/payment-lifecycle.repository";
import {
  type WebhookEventIdentity,
  WebhookEventRepository,
  WebhookEventRepositoryLive,
} from "../repositories/webhook-event.repository";
import { getNexiCurrencyOverride } from "./nexi-currency";
import {
  getProviderEvidenceConflictCodes,
  hasConflictingHistoricalTerminalEvidence,
} from "./provider-evidence-conflict";

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
    if (
      input.verification.status !== "manual_review" &&
      input.verification.mismatches.length === 0
    ) {
      return;
    }
    yield* Effect.logWarning("Nexi webhook verification mismatch detected");

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
  (effect, input) =>
    effect.pipe(
      Effect.annotateLogs({
        eventId: input.eventId,
        orderId: input.orderId,
      })
    )
);

export const NexiWebhookServiceLive = Layer.effect(
  NexiWebhookService,
  Effect.gen(function* () {
    const webhookEvents = yield* WebhookEventRepository;
    const paymentAttempts = yield* PaymentAttemptRepository;
    const paymentLifecycle = yield* PaymentLifecycleRepository;
    const reservations = yield* WorkspaceReservationRepository;
    const nexi = yield* NexiService;
    const fulfillment = yield* WorkspacePaidFulfillmentService;
    const posthogEvents = yield* PostHogEventService;

    const acceptProcessedEvent = Effect.fn("nexiWebhook.acceptProcessedEvent")(
      function* (input: {
        readonly eventId: string;
        readonly providerOrderId: string;
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

        const result = {
          status: "accepted" as const,
          eventId: input.eventId,
          orderId: input.providerOrderId,
        };
        yield* Effect.annotateLogsScoped({ result });
        yield* Effect.logInfo("Nexi webhook processing accepted");

        return result;
      }
    );

    return NexiWebhookService.of({
      processNotification: Effect.fn("nexiWebhook.processNotification")(
        function* (payload) {
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
          const providerOrderId = envelope.operation.orderId.trim();
          if (!isBoundedNexiProviderIdentifier(providerOrderId)) {
            return yield* new NexiWebhookProcessingError({
              errorCode: "nexi_webhook_parse_failed",
              message:
                "Nexi webhook notification identifiers were outside the accepted contract.",
            });
          }
          const { eventId } = deriveNexiWebhookEventIdentity(envelope);
          yield* Effect.logInfo("Nexi webhook notification decoded");

          const attempt = yield* paymentAttempts
            .findByProviderOrderId(providerOrderId)
            .pipe(
              Effect.mapError(
                (cause) =>
                  new NexiWebhookProcessingError({
                    errorCode: "nexi_webhook_unknown_order",
                    message:
                      "Payment attempt could not be loaded for Nexi webhook.",
                    cause,
                  })
              )
            );
          yield* Effect.logDebug(
            "Nexi webhook payment attempt lookup completed"
          );

          if (!attempt) {
            yield* Effect.logWarning(
              "Nexi webhook referenced unknown payment attempt"
            );

            return yield* new NexiWebhookProcessingError({
              errorCode: "nexi_webhook_unknown_order",
              message: "Nexi webhook referenced an unknown payment attempt.",
            });
          }
          if (!isNexiPaymentAttempt(attempt) || !attempt.providerOrderId) {
            return yield* new NexiWebhookProcessingError({
              errorCode: "nexi_webhook_unknown_order",
              message:
                "Nexi webhook referenced an unverifiable provider payment attempt.",
            });
          }
          yield* Effect.logInfo("Nexi webhook payment attempt resolved");
          yield* Effect.annotateLogsScoped({
            eventId,
            providerOrderId: attempt.providerOrderId,
          });

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
          yield* Effect.logInfo("Nexi webhook event recorded");

          if (received.status === "duplicate") {
            if (received.event.state === "processed") {
              yield* Effect.logInfo("Processed duplicate Nexi webhook ignored");
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
                "Concurrent duplicate Nexi webhook already processed"
              );
              return {
                status: "duplicate" as const,
                eventId,
                orderId: providerOrderId,
              };
            }

            yield* Effect.logWarning(
              "Retrying unprocessed duplicate Nexi webhook"
            );
          }

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

          const reconciliation =
            yield* paymentLifecycle.claimProviderReconciliation({
              id: attempt.id,
              workspaceReservationId: reservation.id,
            });
          if (reconciliation.outcome !== "claimed") {
            return yield* failAfterMarkingEvent(
              webhookEvents,
              { type: "eventId", eventId },
              new NexiWebhookProcessingError({
                errorCode: "nexi_webhook_transition_failed",
                eventId,
                orderId: providerOrderId,
                message:
                  "Nexi webhook could not acquire authoritative reconciliation ownership.",
              })
            );
          }
          const reconciliationClaimId = reconciliation.claimId;
          const isActiveAttempt = reconciliation.isActiveAttempt;
          const ownedAttempt = reconciliation.attempt;
          if (
            !isNexiPaymentAttempt(ownedAttempt) ||
            !ownedAttempt.providerOrderId
          ) {
            yield* paymentLifecycle.releaseProviderReconciliation({
              id: attempt.id,
              workspaceReservationId: reservation.id,
              claimId: reconciliationClaimId,
            });
            return yield* failAfterMarkingEvent(
              webhookEvents,
              { type: "eventId", eventId },
              new NexiWebhookProcessingError({
                errorCode: "nexi_webhook_transition_failed",
                eventId,
                orderId: providerOrderId,
                message:
                  "Nexi webhook reconciliation ownership returned a non-Nexi attempt.",
              })
            );
          }
          const admittedProviderOrderId = ownedAttempt.providerOrderId;
          const releaseReconciliation =
            paymentLifecycle.releaseProviderReconciliation({
              id: ownedAttempt.id,
              workspaceReservationId: reservation.id,
              claimId: reconciliationClaimId,
            });

          return yield* Effect.gen(function* () {
            const tokenCheck = checkNexiWebhookSecurityToken({
              notificationSecurityToken: envelope.securityToken,
              expectedSecurityToken: ownedAttempt.securityToken,
            });
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

            const currency = yield* Schema.decodeUnknownEffect(
              NexiCurrencySchema
            )(ownedAttempt.amount.currency).pipe(
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
              orderId: admittedProviderOrderId,
              correlationId: reservation.correlationId,
              amount: String(ownedAttempt.amount.value),
              currency: getNexiCurrencyOverride() ?? currency,
              ...(ownedAttempt.securityToken
                ? { securityToken: ownedAttempt.securityToken }
                : {}),
            };
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
            yield* Effect.logInfo(
              "Nexi webhook payment verification completed"
            );

            const webhookEvidenceMatches = isNexiWebhookEvidenceConsistent({
              notification: envelope,
              expectedOrderId: admittedProviderOrderId,
              expectedAmount: String(ownedAttempt.amount.value),
              expectedCurrency: verificationInput.currency,
              verification,
            });
            // The webhook is an unsigned trigger. Its contradictions reject only
            // this delivery; only authenticated GET/local contradictions below
            // become a durable settlement fence.
            const deliveryVerification = webhookEvidenceMatches
              ? verification
              : {
                  ...verification,
                  status: "manual_review" as const,
                  mismatches: [
                    ...verification.mismatches,
                    "operationEvidence" as const,
                  ],
                };
            if (
              verification.status === "manual_review" ||
              verification.mismatches.length > 0
            ) {
              yield* paymentLifecycle
                .recordEvidenceConflict({
                  id: ownedAttempt.id,
                  workspaceReservationId: reservation.id,
                  reconciliationClaimId,
                  conflictCodes: getProviderEvidenceConflictCodes(verification),
                })
                .pipe(
                  Effect.mapError(
                    () =>
                      new NexiWebhookProcessingError({
                        errorCode: "nexi_webhook_transition_failed",
                        eventId,
                        orderId: providerOrderId,
                        message:
                          "Nexi provider evidence conflict could not be recorded.",
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

            yield* failOnVerificationMismatch({
              eventId,
              orderId: providerOrderId,
              verification: deliveryVerification,
              webhookEvents,
            });

            const providerMetadata = getNexiPaymentMetadata(verification);
            const { providerOperationId, providerStatus } = providerMetadata;
            yield* Effect.annotateLogsScoped({ providerMetadata });
            yield* Effect.logDebug("Nexi webhook provider metadata resolved");

            if (!isActiveAttempt) {
              if (
                hasConflictingHistoricalTerminalEvidence({
                  attemptState: ownedAttempt.state,
                  lastProviderOperationId: ownedAttempt.lastProviderOperationId,
                  lastProviderStatus: ownedAttempt.lastProviderStatus,
                  failureCode: ownedAttempt.failureCode,
                  verificationStatus: verification.status,
                  providerOperationId,
                  providerStatus,
                  verifiedFailureCode:
                    verification.status === "failure"
                      ? "nexi_payment_failed"
                      : null,
                })
              ) {
                yield* paymentLifecycle.recordEvidenceConflict({
                  id: ownedAttempt.id,
                  workspaceReservationId: reservation.id,
                  reconciliationClaimId,
                  conflictCodes: ["provider_terminal_state"],
                });
                yield* Effect.logWarning(
                  "Verified historical webhook evidence fenced the reservation"
                );
              } else {
                yield* Effect.logInfo(
                  "Verified historical webhook evidence matched the replaced attempt"
                );
              }

              return yield* acceptProcessedEvent({
                eventId,
                providerOrderId,
              });
            }

            if (verification.status === "success") {
              yield* Effect.logInfo("Nexi webhook paid transition started");

              const transition = yield* paymentLifecycle
                .markPaid({
                  id: ownedAttempt.id,
                  workspaceReservationId: reservation.id,
                  webhookEventId: eventId,
                  providerOperationId,
                  providerStatus,
                  paidAt: Temporal.Now.instant(),
                  reconciliationClaimId,
                })
                .pipe(
                  Effect.catchTag("PaymentLifecycleStateError", (cause) =>
                    paymentLifecycle
                      .recordEvidenceConflict({
                        id: ownedAttempt.id,
                        workspaceReservationId: reservation.id,
                        reconciliationClaimId,
                        conflictCodes:
                          cause.reason === "provider_evidence_conflict"
                            ? ["provider_terminal_state"]
                            : [],
                      })
                      .pipe(Effect.andThen(Effect.fail(cause)))
                  ),
                  Effect.mapError(
                    () =>
                      new NexiWebhookProcessingError({
                        errorCode: "nexi_webhook_transition_failed",
                        eventId,
                        orderId: providerOrderId,
                        message:
                          "Nexi paid transition conflicted with the recorded provider evidence.",
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
              if (transition.changed) {
                yield* capturePaymentCompleted({
                  attempt: transition.attempt,
                  timestamp: transition.timestamp,
                }).pipe(
                  Effect.provideService(PostHogEventService, posthogEvents)
                );
              }
              yield* Effect.logInfo("Nexi webhook payment attempt marked paid");

              yield* releaseReconciliation;
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

              const transition = yield* paymentLifecycle
                .markTerminal({
                  id: ownedAttempt.id,
                  workspaceReservationId: reservation.id,
                  state: terminalState,
                  failureCode: "nexi_payment_failed",
                  webhookEventId: eventId,
                  providerOperationId,
                  providerStatus,
                  reconciliationClaimId,
                })
                .pipe(
                  Effect.catchTag("PaymentLifecycleStateError", (cause) =>
                    paymentLifecycle
                      .recordEvidenceConflict({
                        id: ownedAttempt.id,
                        workspaceReservationId: reservation.id,
                        reconciliationClaimId,
                        conflictCodes:
                          cause.reason === "provider_evidence_conflict"
                            ? ["provider_terminal_state"]
                            : [],
                      })
                      .pipe(Effect.andThen(Effect.fail(cause)))
                  ),
                  Effect.mapError(
                    () =>
                      new NexiWebhookProcessingError({
                        errorCode: "nexi_webhook_transition_failed",
                        eventId,
                        orderId: providerOrderId,
                        message:
                          "Nexi terminal transition conflicted with the recorded lifecycle outcome.",
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
            } else {
              yield* Effect.logInfo(
                "Nexi webhook verification did not require payment transition"
              );
            }

            return yield* acceptProcessedEvent({
              eventId,
              providerOrderId,
            });
          }).pipe(Effect.ensuring(releaseReconciliation.pipe(Effect.orDie)));
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
    Layer.provide(PaymentAttemptRepositoryLive),
    Layer.provide(PaymentLifecycleRepository.Live),
    Layer.provide(PostHogEventServiceLive),
    Layer.provide(WorkspaceReservationRepositoryLive),
    Layer.provide(WorkspaceDatabaseLive),
    Layer.provide(WorkspacePaidFulfillmentServiceLiveWithDependencies)
  );
