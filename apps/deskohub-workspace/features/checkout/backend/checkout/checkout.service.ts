import { randomUUID } from "node:crypto";
import { DotyposService } from "@deskohub/dotypos";
import {
  type ExternalAPIError as NexiExternalAPIError,
  type NetworkError as NexiNetworkError,
  NexiService,
} from "@deskohub/nexi";
import { Context, Data, Effect, Layer, Match, Predicate, Schema } from "effect";
import { WorkspaceDatabaseLive } from "@/db/database.service";
import {
  type CheckoutSummary,
  getCheckoutSummaryChangedKeys,
} from "@/features/checkout/checkout-summary";
import { getCoworkCheckoutSummary } from "@/features/checkout/checkout-summary-cowork";
import { getMeetingRoomCheckoutSummary } from "@/features/checkout/checkout-summary-meeting-room";
import {
  type LegalEvidenceMap,
  legalEvidenceMapSchema,
  paymentSubmitLegalEvidenceSource,
} from "@/features/checkout/legal-evidence";
import { getCoworkCheckoutDetails } from "@/features/checkout/schemas/checkout-details-cowork";
import { getMeetingRoomCheckoutDetails } from "@/features/checkout/schemas/checkout-details-meeting-room";
import {
  type WorkspaceMoney,
  withWorkspaceMoneyCurrency,
  workspaceMoneyEquals,
} from "@/features/checkout/workspace-money";
import type { DiscountCommitment } from "@/features/discounts";
import type { Locale } from "@/features/i18n";
import {
  type CheckoutLegalAcceptanceSnapshot,
  getLegalAcceptanceSnapshot,
} from "@/features/legal/acceptance-snapshot";
import type { WorkspaceTableUnavailableError } from "@/features/reservation/backend/workspace-availability.service";
import {
  WorkspaceReservationRepository,
  WorkspaceReservationRepositoryLive,
} from "@/features/reservation/backend/workspace-reservation.repository";
import { dotyposCustomerIdSchema } from "@/features/reservation/dotypos-customer";
import { getStoredWorkspaceReservationDetails } from "@/features/reservation/persistence-contracts";
import { hasReservationIntervalEnded } from "@/features/reservation/reservation-interval";
import {
  PostHogEventService,
  PostHogEventServiceLive,
} from "@/shared/backend/analytics/posthog-event.service";
import { DotyposServiceLive } from "@/shared/backend/config/dotypos.config";
import { NexiServiceLive } from "@/shared/backend/config/nexi.config";
import {
  getWorkspaceRuntimeCallbackOrigin,
  type WorkspaceUrlConfigError,
} from "@/shared/backend/config/workspace-url.config";
import {
  capturePaymentCompleted,
  capturePaymentFailed,
  capturePaymentStarted,
} from "../analytics/posthog-lifecycle-events";
import {
  WorkspacePaidFulfillmentService,
  WorkspacePaidFulfillmentServiceLiveWithDependencies,
} from "../fulfillment/paid-fulfillment.service";
import { NexiAmountFromWorkspaceMoney } from "../payment/nexi-amount.codec";
import { getNexiCurrencyOverride } from "../payment/nexi-currency";
import {
  LegalEvidenceEventRepository,
  LegalEvidenceEventRepositoryLive,
} from "../repositories/legal-evidence-event.repository";
import {
  isNexiPaymentAttempt,
  type PaymentAttempt,
  PaymentAttemptRepository,
  PaymentAttemptRepositoryLive,
} from "../repositories/payment-attempt.repository";
import { PaymentLifecycleRepository } from "../repositories/payment-lifecycle.repository";
import { formatWorkspaceReservationNote } from "../reservation/dotypos-reservation.adapter";
import { buildFreshCheckoutPayPath } from "./checkout-pay-url";
import { CheckoutPricingServiceLiveWithDependencies } from "./checkout-pricing.runtime";
import {
  CheckoutPricingService,
  type PaymentPriceAffirmation,
} from "./checkout-pricing.service";
import {
  type BuildSignedPayStateInput,
  getSignedPayStateCheckoutSummary,
  getSignedPayStateSubmittedCode,
  openPayState,
  type SignedPayState,
} from "./pay-state.server";
import {
  PayableReservationService,
  type PayableReservationUnavailableError,
} from "./payable-reservation.service";
import { getReservationStatusPath } from "./reservation-status-url";
import { appendVercelPreviewProtectionBypass } from "./vercel-preview-protection-bypass";

const decodeLegalEvidenceMap = Schema.decodeUnknownSync(
  legalEvidenceMapSchema,
  {
    onExcessProperty: "error",
  }
);
const decodeDotyposCustomerId = Schema.decodeUnknownEffect(
  dotyposCustomerIdSchema
);

export class CheckoutError extends Data.TaggedError("CheckoutError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export interface CheckoutService {
  readonly createHostedPaymentCheckout: (
    input: {
      readonly payStateToken: string;
      readonly legalConsent?: boolean;
    },
    locale: Locale
  ) => Effect.Effect<
    | { readonly status: "redirect"; readonly redirectUrl: string }
    | {
        readonly status: "pricing_changed";
        readonly changedKeys: ReturnType<typeof getCheckoutSummaryChangedKeys>;
        readonly freshSummary: CheckoutSummary;
        readonly freshPayUrl: string;
      }
    | { readonly status: "in_progress" },
    CheckoutError
  >;
}

export const CheckoutService =
  Context.Service<CheckoutService>("CheckoutService");

const generateNexiOrderId = () =>
  `D${BigInt(`0x${randomUUID().replaceAll("-", "")}`)
    .toString(36)
    .toUpperCase()}`;

const toCheckoutUrlError = (cause: WorkspaceUrlConfigError) =>
  Effect.fail(new CheckoutError({ message: cause.message, cause }));

const getCheckoutPayReturnUrl: (
  locale: Locale,
  workspaceReservationId: string,
  outcome?: "cancelled"
) => Effect.Effect<string, CheckoutError> = Effect.fn(
  "getCheckoutPayReturnUrl"
)((locale, workspaceReservationId, outcome) =>
  Effect.gen(function* () {
    const origin = yield* getWorkspaceRuntimeCallbackOrigin;

    return yield* Effect.try({
      try: () => {
        const url = new URL(
          `/${locale}/checkout/pay/return/${workspaceReservationId}`,
          origin
        );
        if (outcome) url.searchParams.set("outcome", outcome);
        appendVercelPreviewProtectionBypass(url);
        return url.toString();
      },
      catch: (cause) =>
        new CheckoutError({
          message: "Payment checkout return URL could not be created.",
          cause,
        }),
    });
  }).pipe(Effect.catchTag("WorkspaceUrlConfigError", toCheckoutUrlError))
);

const getNotificationUrl: Effect.Effect<string, CheckoutError> = Effect.gen(
  function* () {
    const origin = yield* getWorkspaceRuntimeCallbackOrigin;

    return yield* Effect.try({
      try: () => {
        const url = new URL("/api/webhooks/nexi", origin);
        appendVercelPreviewProtectionBypass(url);
        return url.toString();
      },
      catch: (cause) =>
        new CheckoutError({
          message: "Payment checkout notification URL could not be created.",
          cause,
        }),
    });
  }
).pipe(Effect.catchTag("WorkspaceUrlConfigError", toCheckoutUrlError));

const toNexiAmount = Schema.encodeEffect(NexiAmountFromWorkspaceMoney);

const getCheckoutLegalAcceptanceSnapshot: (
  locale: Locale
) => Effect.Effect<CheckoutLegalAcceptanceSnapshot, CheckoutError> = Effect.fn(
  "getCheckoutLegalAcceptanceSnapshot"
)((locale) =>
  getLegalAcceptanceSnapshot(locale).pipe(
    Effect.mapError(
      (cause) =>
        new CheckoutError({
          message: "Legal acceptance snapshot could not be created.",
          cause,
        })
    )
  )
);

const toCheckoutLegalDocuments = (
  documents: CheckoutLegalAcceptanceSnapshot
) => ({
  termsAndConditions: {
    path: documents.termsAndConditions.path,
    hash: documents.termsAndConditions.hash,
    hashAlgorithm: documents.termsAndConditions.hashAlgorithm,
  },
  operatingRules: {
    path: documents.operatingRules.path,
    hash: documents.operatingRules.hash,
    hashAlgorithm: documents.operatingRules.hashAlgorithm,
  },
});

const getCheckoutLegalEvidence = (input: {
  readonly acceptedAt: string;
  readonly locale: Locale;
  readonly legalDocuments: CheckoutLegalAcceptanceSnapshot;
}): LegalEvidenceMap => {
  const documents = toCheckoutLegalDocuments(input.legalDocuments);

  return decodeLegalEvidenceMap({
    [documents.termsAndConditions.hash]: {
      documentKey: "termsAndConditions",
      documentHash: documents.termsAndConditions.hash,
      accepted: true,
      acceptedAt: input.acceptedAt,
      locale: input.locale,
      source: paymentSubmitLegalEvidenceSource,
      document: documents.termsAndConditions,
      acknowledgements: { noRefundAfterPinDelivery: true },
    },
    [documents.operatingRules.hash]: {
      documentKey: "operatingRules",
      documentHash: documents.operatingRules.hash,
      accepted: true,
      acceptedAt: input.acceptedAt,
      locale: input.locale,
      source: paymentSubmitLegalEvidenceSource,
      document: documents.operatingRules,
    },
  });
};

const getCheckoutDetails = (
  prepared: PaymentPriceAffirmation,
  locale: Locale,
  legalEvidence: LegalEvidenceMap
) =>
  Match.value(prepared).pipe(
    Match.discriminatorsExhaustive("kind")({
      cowork: ({ quote, reservation }) =>
        getCoworkCheckoutDetails({
          locale,
          reservation,
          quote,
          legalEvidence,
        }),
      "meeting-room": ({ quote, reservation }) =>
        getMeetingRoomCheckoutDetails({
          locale,
          reservation,
          quote,
          legalEvidence,
        }),
    })
  );

const openFinalPayState: (
  payStateToken: string,
  locale: Locale
) => Effect.Effect<SignedPayState, CheckoutError> = Effect.fn(
  "openFinalPayState"
)(function* (payStateToken, locale) {
  const state = yield* openPayState(payStateToken).pipe(
    Effect.mapError(
      (cause) =>
        new CheckoutError({
          message:
            "Pay state is invalid or expired. Please review checkout again.",
          cause,
        })
    )
  );

  if (state.locale !== locale) {
    return yield* new CheckoutError({
      message: "Pay state locale does not match this checkout session.",
    });
  }

  return state;
});

const getFreshPayUrl: (
  input: BuildSignedPayStateInput
) => Effect.Effect<string, CheckoutError> = Effect.fn("getFreshPayUrl")(
  (input) =>
    buildFreshCheckoutPayPath(input).pipe(
      Effect.mapError(
        (cause) =>
          new CheckoutError({
            message: "A refreshed Pay state could not be created.",
            cause,
          })
      )
    )
);

type MappableCheckoutFailure = CheckoutError | WorkspaceTableUnavailableError;

const isMappableCheckoutFailure = (
  cause: unknown
): cause is MappableCheckoutFailure =>
  Predicate.isTagged(cause, "CheckoutError") ||
  Predicate.isTagged(cause, "WorkspaceTableUnavailableError");

const mapCheckoutFailure = (cause: unknown) => {
  if (isMappableCheckoutFailure(cause)) {
    return Match.value(cause).pipe(
      Match.tag("CheckoutError", (error) => error),
      Match.tag(
        "WorkspaceTableUnavailableError",
        (error) =>
          new CheckoutError({
            message: "workspace_table_unavailable",
            cause: error,
          })
      ),
      Match.exhaustive
    );
  }

  return new CheckoutError({
    message:
      "Payment checkout could not be started. Please review your details and try again.",
    cause,
  });
};

const isReusableAttemptState = (state: string) =>
  state === "created" || state === "pending";

const isDefinitiveHostedPaymentPageFailure = (
  cause: NexiExternalAPIError | NexiNetworkError
) =>
  cause._tag === "ExternalAPIError" &&
  cause.statusCode !== undefined &&
  cause.statusCode >= 400 &&
  cause.statusCode < 500 &&
  ![408, 409, 425, 429].includes(cause.statusCode);

export const CheckoutServiceLive = Layer.effect(
  CheckoutService,
  Effect.gen(function* () {
    const dotypos = yield* DotyposService;
    const nexi = yield* NexiService;
    const reservations = yield* WorkspaceReservationRepository;
    const paymentAttempts = yield* PaymentAttemptRepository;
    const paymentLifecycle = yield* PaymentLifecycleRepository;
    const legalEvidenceEvents = yield* LegalEvidenceEventRepository;
    const paidFulfillment = yield* WorkspacePaidFulfillmentService;
    const posthogEvents = yield* PostHogEventService;
    const pricing = yield* CheckoutPricingService;
    const payableReservations = yield* PayableReservationService;

    const handleHostedPaymentPageCreationFailure = Effect.fn(
      "checkout.handleHostedPaymentPageCreationFailure"
    )(
      (input: {
        readonly cause: NexiExternalAPIError | NexiNetworkError;
        readonly attempt: PaymentAttempt;
        readonly workspaceReservationId: string;
      }) =>
        Match.value(input.cause).pipe(
          Match.when(isDefinitiveHostedPaymentPageFailure, () =>
            Effect.gen(function* () {
              const transition = yield* paymentLifecycle.markTerminal({
                id: input.attempt.id,
                workspaceReservationId: input.workspaceReservationId,
                state: "failed",
                failureCode: "nexi_hpp_create_failed",
                providerStatus: "hpp_create_failed",
              });

              if (transition.changed) {
                yield* capturePaymentFailed({
                  attempt: transition.attempt,
                  failureCode:
                    transition.attempt.lastProviderStatus ??
                    transition.attempt.failureCode ??
                    "nexi_hpp_create_failed",
                  failureReason: "nexi_hpp_create_failed",
                  timestamp: transition.timestamp,
                }).pipe(
                  Effect.provideService(PostHogEventService, posthogEvents)
                );
              }
            })
          ),
          Match.orElse(() =>
            Effect.logError(
              "Ambiguous hosted payment page creation failure retained the active attempt",
              {
                orderId: input.workspaceReservationId,
                paymentAttemptId: input.attempt.id,
                errorTag: input.cause._tag,
              }
            )
          )
        )
    );

    const revalidatePayableReservation = Effect.fn(
      "checkout.revalidatePayableReservation"
    )(function* (input: {
      readonly workspaceReservationId: string;
      readonly checkoutSessionId?: string;
    }) {
      yield* payableReservations.requireCurrent({
        orderId: input.workspaceReservationId,
        checkoutSessionId: input.checkoutSessionId,
      });
      yield* Effect.logDebug("Checkout payable reservation revalidated");
    });

    const startProviderSession = Effect.fn("checkout.startProviderSession")(
      function* (input: {
        readonly workspaceReservationId: string;
        readonly correlationId: string;
        readonly checkoutSessionId?: string;
        readonly locale: Locale;
        readonly total: WorkspaceMoney;
        readonly commitment: DiscountCommitment;
      }) {
        yield* Effect.annotateLogsScoped({
          providerSessionInput: {
            workspaceReservationId: input.workspaceReservationId,
            correlationId: input.correlationId,
            checkoutSessionId: input.checkoutSessionId,
            locale: input.locale,
            total: input.total,
          },
        });
        yield* Effect.logInfo("Checkout provider session start requested");

        yield* revalidatePayableReservation(input);

        const providerOrderId = generateNexiOrderId();
        const nexiAmount = yield* toNexiAmount(
          withWorkspaceMoneyCurrency(input.total, getNexiCurrencyOverride())
        ).pipe(
          Effect.mapError(
            (cause) =>
              new CheckoutError({
                message: "Unsupported payment amount.",
                cause,
              })
          )
        );
        const notificationUrl = yield* getNotificationUrl;
        const resultUrl = yield* getCheckoutPayReturnUrl(
          input.locale,
          input.workspaceReservationId
        );
        const cancelUrl = yield* getCheckoutPayReturnUrl(
          input.locale,
          input.workspaceReservationId,
          "cancelled"
        );
        yield* Effect.annotateLogsScoped({ nexiAmount });
        yield* Effect.logDebug("Checkout provider session inputs prepared");

        const attempt = yield* paymentLifecycle.createPendingNexiAttempt({
          workspaceReservationId: input.workspaceReservationId,
          providerOrderId,
          amount: input.total,
          commitment: input.commitment,
          locale: input.locale,
        });
        if (!isNexiPaymentAttempt(attempt)) {
          return yield* new CheckoutError({
            message: "Nexi payment attempt configuration is invalid.",
          });
        }
        yield* Effect.annotateLogsScoped({ attempt });
        yield* Effect.logInfo("Checkout payment attempt created");

        yield* Effect.logInfo("Nexi hosted payment page creation started");
        const hostedPaymentPage = yield* nexi
          .createHostedPaymentPage({
            orderId: attempt.providerOrderId,
            correlationId: input.correlationId,
            amount: nexiAmount.amount,
            currency: nexiAmount.currency,
            locale: input.locale,
            notificationUrl,
            resultUrl,
            cancelUrl,
          })
          .pipe(
            Effect.tapError((cause) =>
              handleHostedPaymentPageCreationFailure({
                cause,
                attempt,
                workspaceReservationId: input.workspaceReservationId,
              })
            )
          );
        yield* Effect.annotateLogsScoped({ hostedPaymentPage });
        yield* Effect.logInfo("Nexi hosted payment page creation completed");

        yield* Effect.logInfo("Checkout hosted payment page attach started");
        const attachedAttempt = yield* paymentLifecycle
          .attachProviderSession({
            id: attempt.id,
            securityToken: hostedPaymentPage.securityToken,
            providerRedirectUrl: hostedPaymentPage.hostedPage,
          })
          .pipe(
            Effect.tapError((cause) =>
              Effect.logError("Checkout hosted payment page attach failed", {
                attempt,
                hostedPaymentPage,
                cause,
              })
            )
          );
        yield* capturePaymentStarted({
          attempt: attachedAttempt,
          timestamp: attachedAttempt.updatedAt,
        }).pipe(Effect.provideService(PostHogEventService, posthogEvents));
        yield* Effect.logDebug("Checkout hosted payment page attach completed");
        yield* Effect.logInfo("Checkout provider session started");

        return {
          status: "redirect" as const,
          redirectUrl: hostedPaymentPage.hostedPage,
        };
      }
    );

    const completeInternalPayment = Effect.fn(
      "checkout.completeInternalPayment"
    )(function* (input: {
      readonly workspaceReservationId: string;
      readonly checkoutSessionId?: string;
      readonly locale: Locale;
      readonly total: WorkspaceMoney;
      readonly commitment: DiscountCommitment;
    }) {
      yield* revalidatePayableReservation(input);

      const transition = yield* paymentLifecycle.completeInternalPayment({
        workspaceReservationId: input.workspaceReservationId,
        amount: input.total,
        commitment: input.commitment,
        locale: input.locale,
      });

      if (transition.changed) {
        yield* capturePaymentCompleted({
          attempt: transition.attempt,
          timestamp: transition.timestamp,
        }).pipe(Effect.provideService(PostHogEventService, posthogEvents));
      }

      yield* paidFulfillment
        .fulfillPaidOrder({ orderId: input.workspaceReservationId })
        .pipe(
          Effect.catch((cause) =>
            Effect.logError(
              "Internal payment completed but paid fulfillment failed",
              {
                orderId: input.workspaceReservationId,
                paymentAttemptId: transition.attempt.id,
                cause,
              }
            )
          )
        );

      return {
        status: "redirect" as const,
        redirectUrl: getReservationStatusPath({
          locale: input.locale,
          orderId: input.workspaceReservationId,
          outcome: "success",
          setBypassCookie: true,
        }),
      };
    });

    const getCompletedCheckoutResult = Effect.fn(
      "checkout.getCompletedCheckoutResult"
    )(function* (input: { readonly orderId: string; readonly locale: Locale }) {
      yield* paidFulfillment.fulfillPaidOrder({ orderId: input.orderId }).pipe(
        Effect.catch((cause) =>
          Effect.logError("Paid checkout fulfillment retry failed", {
            orderId: input.orderId,
            cause,
          })
        )
      );

      return {
        status: "redirect" as const,
        redirectUrl: getReservationStatusPath({
          locale: input.locale,
          orderId: input.orderId,
          outcome: "success",
          setBypassCookie: true,
        }),
      };
    });

    return CheckoutService.of({
      createHostedPaymentCheckout: Effect.fn(
        "checkout.createHostedPaymentCheckout"
      )(
        function* (input, locale) {
          yield* Effect.annotateLogsScoped({ input, locale });
          yield* Effect.logInfo("Hosted payment checkout creation started");

          if (input.legalConsent !== true) {
            yield* Effect.logInfo(
              "Hosted payment checkout rejected: missing legal consent"
            );

            return yield* new CheckoutError({
              message: "Legal consent is required before checkout.",
            });
          }

          const state = yield* openFinalPayState(input.payStateToken, locale);
          yield* Effect.annotateLogsScoped({ payState: state });
          yield* Effect.logInfo("Hosted payment checkout pay state opened");

          const data = state.reservation;
          const reservation = yield* payableReservations
            .requireCurrent({
              orderId: state.orderId,
              checkoutSessionId: state.checkoutSessionId,
            })
            .pipe(
              Effect.catchTag(
                "PayableReservationUnavailableError",
                (cause: PayableReservationUnavailableError) =>
                  Effect.logInfo(
                    "Hosted payment checkout reservation is unavailable",
                    { orderId: state.orderId, reason: cause.reason }
                  ).pipe(Effect.as(null))
              )
            );
          yield* Effect.annotateLogsScoped({ reservation });

          if (!reservation) {
            const completedReservation = yield* reservations.findById(
              state.orderId
            );
            if (completedReservation?.paymentState === "paid") {
              yield* Effect.logInfo(
                "Hosted payment checkout recovered completed reservation"
              );
              return yield* getCompletedCheckoutResult({
                orderId: completedReservation.id,
                locale,
              });
            }

            yield* Effect.logWarning(
              "Hosted payment checkout returned in_progress: reservation missing"
            );

            return { status: "in_progress" as const };
          }

          if (reservation.paymentState === "paid") {
            yield* Effect.logInfo(
              "Hosted payment checkout reused completed reservation"
            );

            return yield* getCompletedCheckoutResult({
              orderId: reservation.id,
              locale,
            });
          }

          yield* Effect.annotateLogsScoped({
            correlationId: reservation.correlationId,
          });

          if (reservation.reservationState !== "held") {
            yield* Effect.logInfo(
              "Hosted payment checkout returned in_progress: reservation not held"
            );

            return { status: "in_progress" as const };
          }

          if (
            reservation.reservationHoldExpiresAt &&
            Temporal.Instant.compare(
              reservation.reservationHoldExpiresAt,
              Temporal.Now.instant()
            ) <= 0
          ) {
            yield* Effect.logInfo(
              "Hosted payment checkout returned in_progress: reservation hold expired"
            );

            return { status: "in_progress" as const };
          }

          if (
            state.reservation.kind === "meeting-room" &&
            hasReservationIntervalEnded(state.reservation)
          ) {
            yield* Effect.logInfo(
              "Hosted payment checkout rejected: reservation already ended"
            );
            return yield* new CheckoutError({
              message: "Meeting-room reservation has already ended.",
            });
          }

          if (reservation.activePaymentAttemptId) {
            yield* Effect.logDebug(
              "Hosted payment checkout active payment attempt lookup started"
            );
            const attempt = yield* paymentAttempts.findById(
              reservation.activePaymentAttemptId
            );
            yield* Effect.annotateLogsScoped({ activePaymentAttempt: attempt });
            yield* Effect.logDebug(
              "Hosted payment checkout active payment attempt lookup completed"
            );
            if (
              attempt &&
              isReusableAttemptState(attempt.state) &&
              attempt.securityToken &&
              attempt.providerRedirectUrl &&
              workspaceMoneyEquals(attempt.amount, state.acceptedTotal)
            ) {
              yield* Effect.annotateLogsScoped({ attempt });
              yield* Effect.logInfo(
                "Hosted payment checkout reused active provider session"
              );
              return {
                status: "redirect" as const,
                redirectUrl: attempt.providerRedirectUrl,
              };
            }

            if (attempt && isReusableAttemptState(attempt.state)) {
              yield* Effect.logInfo(
                "Hosted payment checkout returned in_progress: active attempt is not reusable for signed summary"
              );

              return { status: "in_progress" as const };
            }
          }

          if (state.changedKeys) {
            yield* Effect.logInfo(
              "Hosted payment checkout returned existing pricing_changed review"
            );

            const freshPayUrl = yield* getFreshPayUrl({
              ...state,
              locale,
              orderId: reservation.id,
            });
            return {
              status: "pricing_changed" as const,
              changedKeys: state.changedKeys,
              freshSummary: getSignedPayStateCheckoutSummary(state),
              freshPayUrl,
            };
          }

          const dotyposCustomerId = yield* decodeDotyposCustomerId(
            reservation.dotyposCustomerId
          ).pipe(
            Effect.mapError(
              (cause) =>
                new CheckoutError({
                  message: "Reservation customer identity is invalid.",
                  cause,
                })
            )
          );
          const prepared = yield* pricing.affirmForPayment({
            ...state,
            dotyposCustomerId,
            locale,
          });
          const acceptedSummary = getSignedPayStateCheckoutSummary(state);
          const freshSummary = Match.value(prepared).pipe(
            Match.discriminatorsExhaustive("kind")({
              cowork: ({ quote, reservation }) =>
                getCoworkCheckoutSummary(reservation, quote),
              "meeting-room": ({ quote, reservation }) =>
                getMeetingRoomCheckoutSummary(reservation, quote),
            })
          );
          yield* Effect.annotateLogsScoped({ quote: prepared.quote });
          yield* Effect.logDebug("Hosted payment checkout quote built");
          yield* Effect.logDebug(
            "Hosted payment checkout quote comparison started"
          );

          if (
            prepared.quote.fingerprint !== state.quote.fingerprint ||
            !workspaceMoneyEquals(freshSummary.total, state.acceptedTotal)
          ) {
            const changedKeys = getCheckoutSummaryChangedKeys(
              acceptedSummary,
              freshSummary
            );
            yield* Effect.annotateLogsScoped({
              changedKeys,
              acceptedQuote: state.quote,
              acceptedTotal: state.acceptedTotal,
            });
            yield* Effect.logInfo(
              "Hosted payment checkout returned pricing_changed"
            );

            const freshPayUrl = yield* getFreshPayUrl({
              ...prepared,
              locale,
              orderId: reservation.id,
              checkoutSessionId: state.checkoutSessionId,
              ...getSignedPayStateSubmittedCode(
                state,
                prepared.quote.payment.discounts
              ),
              changedKeys,
            });
            return {
              status: "pricing_changed" as const,
              changedKeys,
              freshSummary,
              freshPayUrl,
            };
          }
          yield* Effect.logDebug(
            "Hosted payment checkout quote comparison passed"
          );

          yield* reservations.updateReservationDetails({
            id: reservation.id,
            reservationDetails: getStoredWorkspaceReservationDetails(data),
            locale,
          });

          const acceptedAt = Temporal.Now.instant().toString();
          const legalDocuments =
            yield* getCheckoutLegalAcceptanceSnapshot(locale);
          const legalEvidence = getCheckoutLegalEvidence({
            acceptedAt,
            locale,
            legalDocuments,
          });
          const checkoutDetails = getCheckoutDetails(
            prepared,
            locale,
            legalEvidence
          );
          yield* Effect.annotateLogsScoped({ legalEvidence, checkoutDetails });
          yield* Effect.logInfo(
            "Hosted payment checkout legal evidence recording started"
          );
          yield* legalEvidenceEvents.recordMany(
            Object.values(checkoutDetails.legal).map((evidence) => ({
              workspaceReservationId: reservation.id,
              evidence,
            }))
          );
          yield* Effect.logInfo(
            "Hosted payment checkout legal evidence recorded"
          );

          const dotyposReservationId = reservation.dotyposReservationId;
          if (!dotyposReservationId) {
            return yield* new CheckoutError({
              message:
                "Held reservation is missing its Dotypos reservation ID.",
            });
          }

          yield* dotypos.updateReservation({
            reservationId: dotyposReservationId,
            note: formatWorkspaceReservationNote({
              paymentOrderId: reservation.id,
              checkoutDetails,
              reservation: checkoutDetails.reservation,
            }),
          });
          yield* Effect.logInfo(
            "Hosted payment checkout Dotypos reservation note updated"
          );

          const expectedPrice = prepared.quote.payment.expectedPrice;
          const startPayment =
            expectedPrice.value === 0
              ? completeInternalPayment({
                  workspaceReservationId: reservation.id,
                  checkoutSessionId: state.checkoutSessionId,
                  locale,
                  total: expectedPrice,
                  commitment: prepared.commitment,
                })
              : startProviderSession({
                  workspaceReservationId: reservation.id,
                  correlationId: reservation.correlationId,
                  checkoutSessionId: state.checkoutSessionId,
                  locale,
                  total: expectedPrice,
                  commitment: prepared.commitment,
                });

          return yield* startPayment.pipe(
            Effect.catchTag("DiscountClaimError", (cause) =>
              Effect.gen(function* () {
                yield* Effect.logError(
                  "Accepted discount claim admission changed the payable price",
                  {
                    discountBoundary: "claim_admission",
                    discountOperation: cause.operation,
                    discountErrorReason: cause.reason,
                  }
                );
                const refreshed = yield* pricing.affirmForPayment({
                  ...state,
                  dotyposCustomerId,
                  locale,
                });
                const refreshedSummary = Match.value(refreshed).pipe(
                  Match.discriminatorsExhaustive("kind")({
                    cowork: ({ quote, reservation }) =>
                      getCoworkCheckoutSummary(reservation, quote),
                    "meeting-room": ({ quote, reservation }) =>
                      getMeetingRoomCheckoutSummary(reservation, quote),
                  })
                );
                const changedKeys = getCheckoutSummaryChangedKeys(
                  acceptedSummary,
                  refreshedSummary
                );
                const refreshedCheckoutDetails = getCheckoutDetails(
                  refreshed,
                  locale,
                  legalEvidence
                );
                yield* dotypos.updateReservation({
                  reservationId: dotyposReservationId,
                  note: formatWorkspaceReservationNote({
                    paymentOrderId: reservation.id,
                    checkoutDetails: refreshedCheckoutDetails,
                    reservation: refreshedCheckoutDetails.reservation,
                  }),
                });
                const freshPayUrl = yield* getFreshPayUrl({
                  ...refreshed,
                  locale,
                  orderId: reservation.id,
                  checkoutSessionId: state.checkoutSessionId,
                  ...getSignedPayStateSubmittedCode(
                    state,
                    refreshed.quote.payment.discounts
                  ),
                  changedKeys,
                });

                return {
                  status: "pricing_changed" as const,
                  changedKeys,
                  freshSummary: refreshedSummary,
                  freshPayUrl,
                };
              })
            )
          );
        },
        (effect, input, locale) =>
          effect.pipe(
            Effect.scoped,
            Effect.annotateLogs({
              locale,
              hasPayStateToken: input.payStateToken.length > 0,
            }),
            Effect.mapError(mapCheckoutFailure)
          )
      ),
    });
  })
);

export const CheckoutServiceLiveWithDependencies = CheckoutServiceLive.pipe(
  Layer.provide(WorkspacePaidFulfillmentServiceLiveWithDependencies),
  Layer.provide(PayableReservationService.Live),
  Layer.provide(LegalEvidenceEventRepositoryLive),
  Layer.provide(PostHogEventServiceLive),
  Layer.provide(PaymentLifecycleRepository.Live),
  Layer.provide(PaymentAttemptRepositoryLive),
  Layer.provide(WorkspaceReservationRepositoryLive),
  Layer.provide(WorkspaceDatabaseLive),
  Layer.provide(DotyposServiceLive),
  Layer.provide(NexiServiceLive),
  Layer.provide(CheckoutPricingServiceLiveWithDependencies)
);
