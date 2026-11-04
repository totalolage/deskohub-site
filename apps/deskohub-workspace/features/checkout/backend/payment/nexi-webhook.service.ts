import {
  checkNexiWebhookSecurityToken,
  classifyNexiFailureStatus,
  decodeNexiWebhookNotification,
  deriveNexiWebhookEventIdentity,
  getNexiPaymentMetadata,
  isNexiRefundOperation,
  NexiCurrencySchema,
  type NexiFailureStatusKind,
  type NexiOrderId,
  type NexiPaymentMetadata,
  NexiService,
  type NexiWebhookEventId,
  type PaymentVerificationResult,
} from "@deskohub/nexi";
import { Context, Data, Effect, Layer, Predicate, Schema } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import type { PaymentAttemptState, WebhookEvent } from "@/db/schema";
import {
  type WorkspaceReservation,
  WorkspaceReservationRepository,
} from "@/features/reservation/backend/workspace-reservation.repository";
import {
  CheckoutAnalytics,
  type ICheckoutAnalytics,
} from "../analytics/checkout-analytics.service";
import { ReservationFulfillment } from "../fulfillment/reservation-fulfillment.service";
import { LatePaymentRecoveryRepository } from "../repositories/late-payment-recovery.repository";
import {
  type PaymentAttempt,
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
import {
  isVerifiableNexiPaymentAttempt,
  type VerifiableNexiPaymentAttempt,
} from "./verifiable-nexi-payment-attempt";

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

interface NexiWebhookResult {
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
    Layer.provide(LatePaymentRecoveryQueueService.Live),
    Layer.provide(CheckoutAnalytics.Live),
    Layer.provide(WorkspaceReservationRepository.Default),
    Layer.provide(
      PaymentRefundService.Default.pipe(
        Layer.provide(PaymentRefundRepository.Default)
      )
    ),
    Layer.provide(WorkspaceDatabase.Default),
    Layer.provide(ReservationFulfillment.Live)
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

/** The provider event and order every processing failure names. */
interface NotificationIdentity {
  readonly eventId: NexiWebhookEventId;
  readonly providerOrderId: NexiOrderId;
}

/** A notification resolved to its authenticated attempt and reservation. */
interface PaymentNotification extends NotificationIdentity {
  readonly attempt: VerifiableNexiPaymentAttempt;
  readonly reservation: WorkspaceReservation;
}

/** A payment notification with Nexi's matching verification. */
interface VerifiedPaymentNotification extends PaymentNotification {
  readonly verification: PaymentVerificationResult;
  readonly providerMetadata: NexiPaymentMetadata;
}

interface NexiWebhookFailure {
  readonly errorCode: NexiWebhookFailureCode;
  readonly message: string;
}

type NexiWebhookEnvelope = Effect.Success<
  ReturnType<typeof decodeNexiWebhookNotification>
>;

/** Maps a step's failure to the notification's processing error. */
const processingFailure =
  (notification: NotificationIdentity, failure: NexiWebhookFailure) =>
  <E>(cause: E) =>
    new NexiWebhookProcessingError({
      errorCode: failure.errorCode,
      eventId: notification.eventId,
      orderId: notification.providerOrderId,
      message: failure.message,
      cause,
    });

/** Fails a step with `failure`, marking the event failed first. */
const failMarkingEvent =
  (
    webhookEvents: IWebhookEventRepository,
    notification: NotificationIdentity,
    failure: NexiWebhookFailure
  ) =>
  <A, E, R>(step: Effect.Effect<A, E, R>) =>
    step.pipe(
      Effect.mapError(processingFailure(notification, failure)),
      Effect.catch((error) =>
        failAfterMarkingEvent(
          webhookEvents,
          { type: "eventId", eventId: notification.eventId },
          error
        )
      )
    );

/** Rejects the notification with `failure` after marking the event failed. */
const rejectMarkingEvent = (
  webhookEvents: IWebhookEventRepository,
  notification: NotificationIdentity,
  failure: NexiWebhookFailure
) =>
  failAfterMarkingEvent(
    webhookEvents,
    { type: "eventId", eventId: notification.eventId },
    new NexiWebhookProcessingError({
      errorCode: failure.errorCode,
      eventId: notification.eventId,
      orderId: notification.providerOrderId,
      message: failure.message,
    })
  );

const duplicateResult = (notification: NotificationIdentity) => ({
  status: "duplicate" as const,
  eventId: notification.eventId,
  orderId: notification.providerOrderId,
});

/** The analytics event for a payment that ended unpaid. */
const capturePaymentEnded = (
  checkoutAnalytics: ICheckoutAnalytics,
  input: {
    readonly transition: Parameters<ICheckoutAnalytics["paymentAbandoned"]>[0];
    readonly terminalState: NexiFailureStatusKind;
  }
) =>
  input.terminalState === "failed"
    ? checkoutAnalytics.paymentFailed({
        attempt: input.transition.attempt,
        failureReason: "nexi_payment_failed",
        timestamp: input.transition.timestamp,
      })
    : checkoutAnalytics.paymentAbandoned({
        attempt: input.transition.attempt,
        timestamp: input.transition.timestamp,
      });

function makeNexiWebhookServiceLayer(service: typeof NexiWebhookService) {
  return Layer.effect(
    service,
    Effect.gen(function* () {
      const webhookEvents = yield* WebhookEventRepository;
      const paymentAttempts = yield* PaymentAttemptRepository;
      const paymentLifecycle = yield* PaymentLifecycleRepository;
      const reservations = yield* WorkspaceReservationRepository;
      const nexi = yield* NexiService;
      const fulfillment = yield* ReservationFulfillment;
      const checkoutAnalytics = yield* CheckoutAnalytics;
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

      const decodeNotification = Effect.fnUntraced(function* (
        payload: Parameters<typeof decodeNexiWebhookNotification>[0]
      ) {
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

        const notification: NotificationIdentity = { eventId, providerOrderId };
        return { envelope, notification };
      });

      const recordEvent = Effect.fnUntraced(function* (
        notification: NotificationIdentity
      ) {
        const received = yield* webhookEvents
          .insertReceived({
            eventId: notification.eventId,
            providerOrderId: notification.providerOrderId,
            receivedAt: Temporal.Now.instant(),
          })
          .pipe(
            Effect.mapError(
              processingFailure(notification, {
                errorCode: "nexi_webhook_transition_failed",
                message: "Nexi webhook event could not be recorded.",
              })
            )
          );
        yield* Effect.annotateLogsScoped({ received });
        yield* Effect.logInfo("Nexi webhook event recorded");
        return received;
      });

      /**
       * The duplicate result when the event was already processed, here or
       * by a concurrent delivery; otherwise claims the event for a retry.
       */
      const claimDuplicateRetry = Effect.fnUntraced(function* (
        event: Pick<WebhookEvent, "state">,
        notification: NotificationIdentity
      ) {
        const { eventId, providerOrderId } = notification;
        if (event.state === "processed") {
          yield* Effect.logInfo("Processed duplicate Nexi webhook ignored", {
            eventId,
            providerOrderId,
          });
          return duplicateResult(notification);
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
          return duplicateResult(notification);
        }

        yield* Effect.logWarning(
          "Retrying unprocessed duplicate Nexi webhook",
          {
            eventId,
            providerOrderId,
            previousState: event.state,
          }
        );
        return undefined;
      });

      /** The notification's payment attempt, linked to the event. */
      const resolvePaymentAttempt = Effect.fnUntraced(function* (
        notification: NotificationIdentity
      ) {
        const { eventId, providerOrderId } = notification;
        const attempt = yield* paymentAttempts
          .findByProviderOrderId(providerOrderId)
          .pipe(
            Effect.mapError(
              processingFailure(notification, {
                errorCode: "nexi_webhook_unknown_order",
                message:
                  "Payment attempt could not be loaded for Nexi webhook.",
              })
            )
          );
        yield* Effect.annotateLogsScoped({ attempt });
        yield* Effect.logDebug("Nexi webhook payment attempt lookup completed");

        if (!attempt) {
          yield* Effect.logWarning(
            "Nexi webhook referenced unknown payment attempt"
          );

          return yield* rejectMarkingEvent(webhookEvents, notification, {
            errorCode: "nexi_webhook_unknown_order",
            message: "Nexi webhook referenced an unknown payment attempt.",
          });
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
        return attempt;
      });

      const resolveReservation = Effect.fnUntraced(function* (
        attempt: PaymentAttempt,
        notification: NotificationIdentity
      ) {
        const reservation = yield* reservations
          .findById(attempt.workspaceReservationId)
          .pipe(
            Effect.mapError(
              processingFailure(notification, {
                errorCode: "nexi_webhook_unknown_order",
                message:
                  "Workspace reservation could not be loaded for Nexi webhook.",
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

          return yield* rejectMarkingEvent(webhookEvents, notification, {
            errorCode: "nexi_webhook_unknown_order",
            message:
              "Nexi webhook referenced an unknown workspace reservation.",
          });
        }
        yield* Effect.logInfo("Nexi webhook workspace reservation resolved");
        return reservation;
      });

      /**
       * The attempt once the notification's security token, when present,
       * matches it and it stores the token Nexi's verification needs.
       */
      const authenticateAttempt = Effect.fnUntraced(function* (
        envelope: NexiWebhookEnvelope,
        attempt: PaymentAttempt,
        notification: NotificationIdentity
      ) {
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

          return yield* rejectMarkingEvent(webhookEvents, notification, {
            errorCode: "nexi_webhook_verification_mismatch",
            message: "Nexi webhook security token did not match.",
          });
        }

        if (!isVerifiableNexiPaymentAttempt(attempt)) {
          yield* Effect.logWarning(
            "Nexi webhook payment attempt is missing security token"
          );

          return yield* rejectMarkingEvent(webhookEvents, notification, {
            errorCode: "nexi_webhook_missing_security_token",
            message: "Payment attempt has no stored Nexi security token.",
          });
        }
        return attempt;
      });

      // A refund notification reports money going back on an already
      // paid order. It must never re-run the paid transition or
      // fulfillment, so it only records what Nexi's order now shows.
      const reconcileRefund = Effect.fnUntraced(function* (
        payment: PaymentNotification
      ) {
        yield* Effect.logInfo("Nexi webhook refund reconciliation started");
        const refundResult = yield* paymentRefunds
          .reconcileAttempt({
            attempt: payment.attempt,
            correlationId: payment.reservation.correlationId,
          })
          .pipe(
            failMarkingEvent(webhookEvents, payment, {
              errorCode: "nexi_webhook_refund_reconciliation_failed",
              message: "Nexi refund could not be reconciled.",
            })
          );
        yield* Effect.annotateLogsScoped({ refundResult });
        yield* Effect.logInfo("Nexi webhook refund reconciliation completed");

        return yield* acceptEvent({
          eventId: payment.eventId,
          providerOrderId: payment.providerOrderId,
        });
      });

      const verifyPayment = Effect.fnUntraced(function* (
        payment: PaymentNotification
      ) {
        const { attempt, eventId, providerOrderId, reservation } = payment;
        const currency = yield* Schema.decodeUnknownEffect(NexiCurrencySchema)(
          attempt.amount.currency
        ).pipe(
          failMarkingEvent(webhookEvents, payment, {
            errorCode: "nexi_webhook_invalid_currency",
            message: "Payment attempt has an invalid Nexi currency.",
          })
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
            failMarkingEvent(webhookEvents, payment, {
              errorCode: "nexi_webhook_verification_failed",
              message: "Nexi provider verification failed.",
            })
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
        yield* Effect.annotateLogsScoped({ providerMetadata });
        yield* Effect.logDebug("Nexi webhook provider metadata resolved");

        const verified: VerifiedPaymentNotification = {
          ...payment,
          verification,
          providerMetadata,
        };
        return verified;
      });

      const startLatePaymentRecovery = Effect.fnUntraced(function* (
        payment: VerifiedPaymentNotification
      ) {
        const { attempt, eventId, providerOrderId, reservation } = payment;
        const { providerOperationId, providerStatus } =
          payment.providerMetadata;
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
            failMarkingEvent(webhookEvents, payment, {
              errorCode: "nexi_webhook_late_payment_recovery_failed",
              message: "Nexi late-payment recovery could not be started.",
            })
          );
      });

      const markPaidAndFulfill = Effect.fnUntraced(function* (
        payment: VerifiedPaymentNotification
      ) {
        const { attempt, eventId, reservation } = payment;
        const { providerOperationId, providerStatus } =
          payment.providerMetadata;
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
          yield* checkoutAnalytics.paymentCompleted({
            attempt: transition.attempt,
            timestamp: transition.timestamp,
          });
        }
        yield* Effect.logInfo("Nexi webhook payment attempt marked paid");

        yield* fulfillment.run(reservation.id).pipe(
          failMarkingEvent(webhookEvents, payment, {
            errorCode: "nexi_webhook_fulfillment_failed",
            message: "Paid workspace reservation fulfillment failed.",
          })
        );
        yield* Effect.logInfo("Nexi webhook paid order fulfilled");
      });

      const markPaymentTerminal = Effect.fnUntraced(function* (
        payment: VerifiedPaymentNotification
      ) {
        const { attempt, eventId, reservation } = payment;
        const { providerOperationId, providerStatus } =
          payment.providerMetadata;
        const terminalState = classifyNexiFailureStatus(providerStatus);
        yield* Effect.annotateLogsScoped({
          failureKind: terminalState,
          terminalState,
        });
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
          yield* capturePaymentEnded(checkoutAnalytics, {
            transition,
            terminalState,
          });
        }
        yield* Effect.logInfo("Nexi webhook payment attempt marked terminal");
      });

      /**
       * Applies Nexi's verified outcome: a success on a terminal attempt
       * starts late-payment recovery, a success on a live attempt marks it
       * paid and fulfills, and a failure marks it terminal.
       */
      const applyVerifiedOutcome = Effect.fnUntraced(function* (
        payment: VerifiedPaymentNotification
      ) {
        const settled = payment.verification.status === "success";
        const attemptEnded = isTerminalPaymentAttemptState(
          payment.attempt.state
        );
        if (settled && attemptEnded) {
          yield* startLatePaymentRecovery(payment);
        }

        if (settled && !attemptEnded) {
          yield* markPaidAndFulfill(payment);
        } else if (payment.verification.status === "failure") {
          yield* markPaymentTerminal(payment);
        } else {
          yield* Effect.logInfo(
            "Nexi webhook verification did not require payment transition"
          );
        }
      });

      return NexiWebhookService.of({
        processNotification: Effect.fn("nexiWebhook.processNotification")(
          function* (payload) {
            yield* Effect.annotateLogsScoped({ payload });
            yield* Effect.logInfo("Nexi webhook processing started");

            const { envelope, notification } =
              yield* decodeNotification(payload);

            const received = yield* recordEvent(notification);
            if (received.status === "duplicate") {
              const duplicate = yield* claimDuplicateRetry(
                received.event,
                notification
              );
              if (duplicate) return duplicate;
            }

            const attempt = yield* resolvePaymentAttempt(notification);
            const reservation = yield* resolveReservation(
              attempt,
              notification
            );
            const payment: PaymentNotification = {
              ...notification,
              attempt: yield* authenticateAttempt(
                envelope,
                attempt,
                notification
              ),
              reservation,
            };

            if (isNexiRefundOperation(envelope.operation)) {
              return yield* reconcileRefund(payment);
            }

            const verified = yield* verifyPayment(payment);
            yield* applyVerifiedOutcome(verified);

            return yield* acceptEvent(notification);
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
