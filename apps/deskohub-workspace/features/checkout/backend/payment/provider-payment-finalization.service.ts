import {
  classifyNexiFailureStatus,
  type ExternalAPIError,
  getNexiPaymentMetadata,
  type NetworkError,
  type NexiCurrency,
  NexiCurrencySchema,
  type NexiPaymentMetadata,
  NexiService,
  type NexiWebhookEventId,
  type PaymentVerificationResult,
} from "@deskohub/nexi";
import {
  Context,
  Data,
  type Duration,
  Effect,
  Layer,
  Match,
  Option,
  Schema,
  type Scope,
} from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import type { PaymentAttemptId } from "@/features/checkout/checkout-identifiers";
import {
  type WorkspaceReservation,
  WorkspaceReservationRepository,
} from "@/features/reservation/backend/workspace-reservation.repository";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import { WorkspaceNexiLayer } from "@/shared/backend/config/nexi.config";
import {
  getProviderOrderAbandonment,
  getProviderOrderAbandonmentCutoff,
  hasProviderPaymentActivity,
} from "../../provider-order-abandonment";
import { CheckoutAnalytics } from "../analytics/checkout-analytics.service";
import { PaidFulfillmentQueueService } from "../fulfillment/paid-fulfillment-queue.service";
import { ReservationFulfillment } from "../fulfillment/reservation-fulfillment.service";
import {
  isNexiPaymentAttempt,
  type NexiPaymentAttempt,
  type PaymentAttempt,
  PaymentAttemptRepository,
} from "../repositories/payment-attempt.repository";
import {
  PaymentLifecycleRepository,
  type PaymentLifecycleRepositoryError,
} from "../repositories/payment-lifecycle.repository";
import { getNexiCurrencyOverride } from "./nexi-currency";
import {
  isVerifiableNexiPaymentAttempt,
  type VerifiableNexiPaymentAttempt,
} from "./verifiable-nexi-payment-attempt";

/**
 * An operation-free provider order, or an unattached session, still inside
 * its abandonment window. Nothing can resolve it before `abandonmentCutoff`.
 */
export class ProviderPaymentDeferral extends Data.TaggedClass(
  "ProviderPaymentDeferral"
)<{
  readonly abandonmentCutoff: Temporal.Instant;
}> {}

type ProviderPaymentFinalizationResult =
  | "abandoned"
  | ProviderPaymentDeferral
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
    readonly orderId: WorkspaceReservationId;
    readonly paymentAttemptId?: PaymentAttemptId;
    readonly webhookEventId?: NexiWebhookEventId;
    readonly abandonmentCheckedAt?: Temporal.Instant;
    /** Bounds the Nexi payment verification, retries included. */
    readonly verificationDeadline?: Duration.Input;
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
    Layer.provide(CheckoutAnalytics.Live),
    Layer.provide(WorkspaceReservationRepository.Default),
    Layer.provide(WorkspaceDatabase.Default),
    Layer.provide(ReservationFulfillment.Live),
    Layer.provide(PaidFulfillmentQueueService.Live),
    Layer.provide(WorkspaceNexiLayer)
  );
}

function makeProviderPaymentFinalizationServiceLayer(
  service: typeof ProviderPaymentFinalizationService
) {
  return Layer.effect(
    service,
    Effect.gen(function* () {
      const reservations = yield* WorkspaceReservationRepository;
      const paymentAttempts = yield* PaymentAttemptRepository;
      const paymentLifecycle = yield* PaymentLifecycleRepository;
      const nexi = yield* NexiService;
      const paidFulfillmentQueue = yield* PaidFulfillmentQueueService;
      const fulfillment = yield* ReservationFulfillment;
      const checkoutAnalytics = yield* CheckoutAnalytics;

      /**
       * Ends an attempt whose hosted payment page creation failed ambiguously
       * and never attached a provider session. Nexi documents no idempotency
       * key for hosted page creation and its order lookup returns no hosted
       * page, so the original session cannot be recovered. It is also
       * unpayable: only an attached session's hosted page reaches the
       * customer. Hold cleanup fails it after the abandonment window unless
       * the provider order unexpectedly shows payment activity.
       */
      const resolveUnattachedProviderSession = Effect.fn(
        "providerPaymentFinalization.resolveUnattachedProviderSession"
      )(function* (input: {
        readonly reservation: Pick<
          WorkspaceReservation,
          "id" | "correlationId"
        >;
        readonly attempt: NexiPaymentAttempt;
        readonly checkedAt: Temporal.Instant | undefined;
      }): Effect.fn.Return<
        ProviderPaymentFinalizationResult,
        PaymentLifecycleRepositoryError
      > {
        if (!input.checkedAt) {
          yield* Effect.logWarning(
            "Payment finalization left an unattached provider session for hold cleanup"
          );
          return "not_verifiable";
        }
        const abandonmentCutoff = getProviderOrderAbandonmentCutoff(
          input.attempt.createdAt
        );
        if (Temporal.Instant.compare(input.checkedAt, abandonmentCutoff) < 0) {
          yield* Effect.logInfo(
            "Payment finalization deferred an unattached provider session"
          );
          return new ProviderPaymentDeferral({ abandonmentCutoff });
        }

        const providerOrder = yield* nexi
          .getOrder({
            orderId: input.attempt.providerOrderId,
            correlationId: input.reservation.correlationId,
          })
          .pipe(
            Effect.map(Option.some),
            Effect.catchIf(isProviderOrderNotFound, () => Effect.succeedNone),
            Effect.tapError((cause) =>
              Effect.logError(
                "Unattached provider session order lookup failed",
                { cause }
              )
            ),
            Effect.option
          );
        if (Option.isNone(providerOrder)) {
          return "provider_verification_failed";
        }
        if (
          Option.isSome(providerOrder.value) &&
          hasProviderPaymentActivity({
            operationCount: providerOrder.value.value.operations.length,
            authorizedAmount: providerOrder.value.value.authorizedAmount,
            capturedAmount: providerOrder.value.value.capturedAmount,
          })
        ) {
          yield* Effect.logError(
            "Unattached provider session has payment activity and needs operator review"
          );
          return "not_verifiable";
        }

        const terminal = yield* paymentLifecycle
          .markTerminal({
            id: input.attempt.id,
            workspaceReservationId: input.reservation.id,
            state: "failed",
            failureCode: "nexi_hpp_create_unconfirmed",
            providerStatus: "hpp_create_unconfirmed",
            fromAttemptStates: ["created"],
          })
          .pipe(
            Effect.catchTag(
              "PaymentLifecycleStateError",
              Effect.fn(function* (cause) {
                yield* Effect.logWarning(
                  "Unattached provider session changed before it could fail",
                  { cause }
                );
                return undefined;
              })
            )
          );
        if (!terminal) return "not_pending";

        if (terminal.changed) {
          yield* checkoutAnalytics.paymentFailed({
            attempt: terminal.attempt,
            failureReason: "nexi_hpp_create_unconfirmed",
            timestamp: terminal.timestamp,
          });
        }
        yield* Effect.logInfo(
          "Payment finalization failed an unattached provider session",
          { providerOrderFound: Option.isSome(providerOrder.value) }
        );
        return "terminal";
      });

      const enqueueFulfillment = Effect.fn(
        "providerPaymentFinalization.enqueueFulfillment"
      )(function* (input: {
        readonly orderId: WorkspaceReservationId;
        readonly paymentAttemptId?: PaymentAttemptId;
      }) {
        // Payment is already recorded, so a queue outage falls back to
        // fulfilling inline rather than leaving the order unscheduled.
        yield* paidFulfillmentQueue.enqueue({ orderId: input.orderId }).pipe(
          Effect.tap(() =>
            Effect.logInfo("Payment finalization fulfillment enqueued")
          ),
          Effect.catch((cause) =>
            Effect.logError(
              "Paid order fulfillment could not be enqueued; fulfilling inline",
              { ...input, cause }
            ).pipe(
              Effect.andThen(fulfillment.run(input.orderId)),
              Effect.tapError((cause) =>
                Effect.logFatal(
                  "Paid order fulfillment failed during finalization",
                  { ...input, cause }
                )
              ),
              Effect.ignore
            )
          )
        );
      });

      const loadReservation = Effect.fnUntraced(function* (
        orderId: WorkspaceReservationId
      ) {
        return yield* reservations.findById(orderId).pipe(
          Effect.tapError((cause) =>
            Effect.logError("Payment finalization reservation lookup failed", {
              orderId,
              cause,
            })
          ),
          Effect.orElseSucceed(() => null)
        );
      });

      /** A reservation whose payment already left `pending`. */
      const resolveSettledReservation = Effect.fnUntraced(function* (
        reservation: WorkspaceReservation
      ) {
        const progress = settledReservationProgress(reservation);
        if (progress === "fulfillment_stalled") {
          // Safety net for a paid order whose webhook fulfillment
          // stalled. The queue dedupes per order, so repeated status
          // refreshes enqueue at most one message.
          yield* Effect.logWarning(
            "Payment finalization enqueueing fulfillment for already-paid reservation"
          );
          yield* enqueueFulfillment({ orderId: reservation.id });
          return "paid" as const;
        }
        if (progress === "fulfilled") {
          yield* Effect.logInfo(
            "Payment finalization returned paid for fulfilled reservation"
          );
          return "paid" as const;
        }

        yield* Effect.logInfo("Payment finalization returned not_pending");
        return "not_pending" as const;
      });

      const loadPaymentAttempt = Effect.fnUntraced(function* (
        reservation: WorkspaceReservation,
        paymentAttemptId: PaymentAttemptId
      ) {
        const attempt = yield* paymentAttempts.findById(paymentAttemptId).pipe(
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
        yield* Effect.logDebug("Payment finalization attempt lookup completed");
        return attempt;
      });

      const decodeAttemptCurrency = Effect.fnUntraced(function* (
        verifiable: VerifiableAttemptFinalization
      ) {
        const { input, reservation, attempt } = verifiable;
        const currency = yield* Schema.decodeUnknownEffect(NexiCurrencySchema)(
          attempt.amount.currency
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
        return currency;
      });

      const verifyProviderPayment = Effect.fnUntraced(function* (
        { input, reservation, attempt }: VerifiableAttemptFinalization,
        currency: NexiCurrency
      ) {
        yield* Effect.logInfo(
          "Payment finalization provider verification started"
        );
        const verification = yield* nexi
          .verifyPaymentOutcome({
            orderId: attempt.providerOrderId,
            correlationId: reservation.correlationId,
            amount: String(attempt.amount.value),
            currency: getNexiCurrencyOverride() ?? currency,
            securityToken: attempt.securityToken,
            deadline: input.verificationDeadline,
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
        return verification;
      });

      const markVerifiedPaymentPaid = Effect.fnUntraced(function* (
        { input, reservation, attempt }: VerifiableAttemptFinalization,
        { providerOperationId, providerStatus }: NexiPaymentMetadata
      ) {
        yield* Effect.logInfo("Payment finalization mark paid started");
        const paidSuccess = yield* paymentLifecycle
          .markPaid({
            id: attempt.id,
            workspaceReservationId: reservation.id,
            webhookEventId: input.webhookEventId,
            providerOperationId,
            providerStatus,
            paidAt: Temporal.Now.instant(),
          })
          .pipe(
            Effect.catchTag(
              "PaymentLifecycleStateError",
              Effect.fn(function* (cause) {
                yield* Effect.logWarning(
                  "Payment finalization mark paid returned not_pending",
                  { cause }
                );
                return undefined;
              })
            )
          );

        if (!paidSuccess) {
          return "not_pending" as const;
        }
        if (paidSuccess.changed) {
          yield* checkoutAnalytics.paymentCompleted({
            attempt: paidSuccess.attempt,
            timestamp: paidSuccess.timestamp,
          });
        }
        yield* Effect.logDebug("Payment finalization mark paid completed");

        yield* enqueueFulfillment({
          orderId: reservation.id,
          paymentAttemptId: attempt.id,
        });
        return "paid" as const;
      });

      const markVerifiedPaymentTerminal = Effect.fnUntraced(function* (
        { input, reservation, attempt }: VerifiableAttemptFinalization,
        { providerOperationId, providerStatus }: NexiPaymentMetadata
      ) {
        const terminalState = classifyNexiFailureStatus(providerStatus);
        yield* Effect.annotateLogsScoped({
          failureKind: terminalState,
          terminalState,
        });

        yield* Effect.logInfo("Payment finalization mark terminal started");
        const terminalSuccess = yield* paymentLifecycle
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
            Effect.catchTag(
              "PaymentLifecycleStateError",
              Effect.fn(function* (cause) {
                yield* Effect.logWarning(
                  "Payment finalization mark terminal returned not_pending",
                  { cause }
                );
                return undefined;
              })
            )
          );

        if (!terminalSuccess) {
          return "not_pending" as const;
        }
        if (terminalSuccess.changed) {
          if (terminalState === "failed") {
            yield* checkoutAnalytics.paymentFailed({
              attempt: terminalSuccess.attempt,
              failureReason: "nexi_payment_failed",
              timestamp: terminalSuccess.timestamp,
            });
          } else {
            yield* checkoutAnalytics.paymentAbandoned({
              attempt: terminalSuccess.attempt,
              timestamp: terminalSuccess.timestamp,
            });
          }
        }
        yield* Effect.logDebug("Payment finalization mark terminal completed");

        return "terminal" as const;
      });

      /** A verified provider order that is neither paid nor failed. */
      const resolvePendingProviderOrder = Effect.fnUntraced(function* (
        { input, attempt }: VerifiableAttemptFinalization,
        verification: PaymentVerificationResult
      ) {
        const emptyOrder = getProviderOrderAbandonment({
          checkedAt: input.abandonmentCheckedAt,
          providerOrderCreatedAt: attempt.providerOrderCreatedAt,
          order: verification.provider,
        });
        if (emptyOrder.state !== "not_empty") {
          yield* Effect.logInfo(
            "Payment finalization resolved empty provider order",
            { result: emptyOrder.state }
          );
          return Match.value(emptyOrder).pipe(
            Match.discriminatorsExhaustive("state")({
              abandoned: () => "abandoned" as const,
              deferred: ({ cutoff }) =>
                new ProviderPaymentDeferral({ abandonmentCutoff: cutoff }),
            })
          );
        }

        yield* Effect.logInfo("Payment finalization returned pending");
        return "pending" as const;
      });

      const finalizeVerifiableAttempt = Effect.fnUntraced(function* (
        verifiable: VerifiableAttemptFinalization
      ): Effect.fn.Return<
        ProviderPaymentFinalizationResult,
        PaymentLifecycleRepositoryError,
        Scope.Scope
      > {
        const currency = yield* decodeAttemptCurrency(verifiable);
        if (!currency) {
          yield* Effect.logWarning(
            "Payment finalization returned not_verifiable"
          );
          return "not_verifiable";
        }

        const verification = yield* verifyProviderPayment(verifiable, currency);
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

        const metadata = getNexiPaymentMetadata(verification);
        yield* Effect.annotateLogsScoped({
          providerMetadata: {
            providerOperationId: metadata.providerOperationId,
            providerStatus: metadata.providerStatus,
          },
        });
        yield* Effect.logDebug(
          "Payment finalization provider metadata resolved"
        );

        if (verification.status === "success") {
          return yield* markVerifiedPaymentPaid(verifiable, metadata);
        }
        if (verification.status === "failure") {
          return yield* markVerifiedPaymentTerminal(verifiable, metadata);
        }
        return yield* resolvePendingProviderOrder(verifiable, verification);
      });

      return ProviderPaymentFinalizationService.of({
        finalizePendingProviderPayment: Effect.fn(
          "providerPaymentFinalization.finalizePendingProviderPayment"
        )(
          function* (input) {
            yield* Effect.annotateLogsScoped({ input });
            yield* Effect.logInfo("Provider payment finalization started");

            const reservation = yield* loadReservation(input.orderId);
            const paymentAttemptId =
              input.paymentAttemptId ?? reservation?.activePaymentAttemptId;
            yield* Effect.annotateLogsScoped({ reservation, paymentAttemptId });
            yield* Effect.logDebug(
              "Payment finalization reservation lookup completed"
            );

            if (!reservation || !paymentAttemptId) {
              yield* Effect.logInfo("Payment finalization returned not_found");
              return "not_found";
            }
            if (reservation.paymentState !== "pending") {
              return yield* resolveSettledReservation(reservation);
            }

            const attempt = yield* loadPaymentAttempt(
              reservation,
              paymentAttemptId
            );
            if (isUnattachedProviderSession(attempt)) {
              return yield* resolveUnattachedProviderSession({
                reservation,
                attempt,
                checkedAt: input.abandonmentCheckedAt,
              });
            }
            if (!isVerifiableNexiPaymentAttempt(attempt)) {
              yield* Effect.logWarning(
                "Payment finalization returned not_verifiable"
              );
              return "not_verifiable";
            }

            return yield* finalizeVerifiableAttempt({
              input,
              reservation,
              attempt,
            });
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

type ProviderPaymentFinalizationInput = Parameters<
  IProviderPaymentFinalizationService["finalizePendingProviderPayment"]
>[0];

interface VerifiableAttemptFinalization {
  readonly input: ProviderPaymentFinalizationInput;
  readonly reservation: WorkspaceReservation;
  readonly attempt: VerifiableNexiPaymentAttempt;
}

/**
 * Where a reservation whose payment left `pending` stands: a paid order
 * whose fulfillment stalled, a paid order already delivered or delivering,
 * or neither.
 */
const settledReservationProgress = (
  reservation: Pick<WorkspaceReservation, "paymentState" | "fulfillmentState">
) => {
  if (reservation.paymentState !== "paid") return "not_pending";
  if (
    reservation.fulfillmentState === "not_started" ||
    reservation.fulfillmentState === "processing"
  ) {
    return "fulfillment_stalled";
  }
  if (
    reservation.fulfillmentState === "awaiting_delivery" ||
    reservation.fulfillmentState === "fulfilled"
  ) {
    return "fulfilled";
  }
  return "not_pending";
};

/** A Nexi attempt whose hosted payment page creation never attached a session. */
const isUnattachedProviderSession = (
  attempt: PaymentAttempt | null
): attempt is NexiPaymentAttempt => {
  if (!attempt || !isNexiPaymentAttempt(attempt)) return false;
  return attempt.state === "created" && !attempt.securityToken;
};

// Nexi documents 404 as "Order not found" for GET /orders/{orderId}.
const isProviderOrderNotFound = (error: ExternalAPIError | NetworkError) =>
  error._tag === "ExternalAPIError" && error.statusCode === 404;
