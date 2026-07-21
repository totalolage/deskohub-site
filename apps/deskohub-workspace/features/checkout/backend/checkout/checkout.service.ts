import { randomUUID } from "node:crypto";
import { DotyposService } from "@deskohub/dotypos";
import { NexiService } from "@deskohub/nexi";
import { Context, Data, Effect, Layer, Match, Predicate, Schema } from "effect";
import { WorkspaceDatabaseLive } from "@/db/database.service";
import { env } from "@/env";
import {
  getCheckoutSummaryChangedKeys,
  type WorkspaceCheckoutQuote,
} from "@/features/checkout/checkout-quote";
import {
  type LegalEvidenceMap,
  legalEvidenceMapSchema,
  paymentSubmitLegalEvidenceSource,
} from "@/features/checkout/legal-evidence";
import type { CheckoutDetailsJson } from "@/features/checkout/schemas/checkout-details";
import {
  withWorkspaceMoneyCurrency,
  workspaceMoneyEquals,
} from "@/features/checkout/workspace-money";
import type { CanonicalDiscountCode } from "@/features/discounts";
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
import {
  getCoworkReservationDetails,
  type NormalizedCoworkReservationOrder,
} from "@/features/reservation/cowork-reservation";
import { getStoredCoworkReservationDetails } from "@/features/reservation/cowork-reservation-product";
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
  capturePaymentFailed,
  capturePaymentStarted,
} from "../analytics/posthog-lifecycle-events";
import { NexiAmountFromWorkspaceMoney } from "../payment/nexi-amount.codec";
import {
  LegalEvidenceEventRepository,
  LegalEvidenceEventRepositoryLive,
} from "../repositories/legal-evidence-event.repository";
import {
  PaymentAttemptRepository,
  PaymentAttemptRepositoryLive,
} from "../repositories/payment-attempt.repository";
import { formatWorkspaceReservationNote } from "../reservation/dotypos-reservation.adapter";
import { buildFreshCheckoutPayPath } from "./checkout-pay-url";
import { CheckoutPricingServiceLiveWithDependencies } from "./checkout-pricing.runtime";
import { CheckoutPricingService } from "./checkout-pricing.service";
import { openPayState, type SignedPayState } from "./pay-state.server";
import { appendVercelPreviewProtectionBypass } from "./vercel-preview-protection-bypass";

const decodeLegalEvidenceMap = Schema.decodeUnknownSync(
  legalEvidenceMapSchema,
  {
    onExcessProperty: "error",
  }
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
        readonly freshSummary: WorkspaceCheckoutQuote["summary"];
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

const getCheckoutOrderReturnUrl: (
  locale: Locale,
  workspaceReservationId: string
) => Effect.Effect<string, CheckoutError> = Effect.fn(
  "getCheckoutOrderReturnUrl"
)((locale, workspaceReservationId) =>
  Effect.gen(function* () {
    const origin = yield* getWorkspaceRuntimeCallbackOrigin;

    return yield* Effect.try({
      try: () => {
        const url = new URL(
          `/${locale}/checkout/result/${workspaceReservationId}`,
          origin
        );
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

const getCheckoutPaymentRetryUrl: (
  locale: Locale,
  workspaceReservationId: string,
  outcome: "cancelled"
) => Effect.Effect<string, CheckoutError> = Effect.fn(
  "getCheckoutPaymentRetryUrl"
)((locale, workspaceReservationId, outcome) =>
  Effect.gen(function* () {
    const origin = yield* getWorkspaceRuntimeCallbackOrigin;

    return yield* Effect.try({
      try: () => {
        const url = new URL(
          `/${locale}/checkout/payment/${workspaceReservationId}`,
          origin
        );
        url.searchParams.set("outcome", outcome);
        appendVercelPreviewProtectionBypass(url);
        return url.toString();
      },
      catch: (cause) =>
        new CheckoutError({
          message: "Payment checkout retry URL could not be created.",
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

const getNexiCheckoutCurrencyOverride = () => {
  if (env.VERCEL_ENV === "production") return undefined;
  if (new URL(env.NEXI_API_ORIGIN).hostname !== "xpaysandbox.nexigroup.com") {
    return undefined;
  }
  return env.NEXI_CHECKOUT_CURRENCY_OVERRIDE || undefined;
};

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

const buildCheckoutDetailsForPayment = (input: {
  readonly locale: Locale;
  readonly data: NormalizedCoworkReservationOrder;
  readonly quote: WorkspaceCheckoutQuote;
  readonly legalEvidence: LegalEvidenceMap;
}): CheckoutDetailsJson => ({
  schema: "workspace-checkout-details",
  schemaVersion: 1,
  locale: input.locale,
  reservation: getCoworkReservationDetails(input.data),
  payment: {
    expectedPrice: input.quote.payment.expectedPrice,
    undiscountedPrice: input.quote.payment.undiscountedPrice,
    discounts: [...input.quote.payment.discounts],
    summary: input.quote.summary,
  },
  legal: input.legalEvidence,
});

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

const getFreshPayUrl: (input: {
  readonly locale: Locale;
  readonly reservation: NormalizedCoworkReservationOrder;
  readonly quote: WorkspaceCheckoutQuote;
  readonly orderId: string;
  readonly submittedCode: CanonicalDiscountCode | undefined;
  readonly changedKeys: ReturnType<typeof getCheckoutSummaryChangedKeys>;
}) => Effect.Effect<string, CheckoutError> = Effect.fn("getFreshPayUrl")(
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

export const CheckoutServiceLive = Layer.effect(
  CheckoutService,
  Effect.gen(function* () {
    const dotypos = yield* DotyposService;
    const nexi = yield* NexiService;
    const reservations = yield* WorkspaceReservationRepository;
    const paymentAttempts = yield* PaymentAttemptRepository;
    const legalEvidenceEvents = yield* LegalEvidenceEventRepository;
    const posthogEvents = yield* PostHogEventService;
    const pricing = yield* CheckoutPricingService;

    const startProviderSession = Effect.fn("checkout.startProviderSession")(
      function* (input: {
        readonly workspaceReservationId: string;
        readonly correlationId: string;
        readonly locale: Locale;
        readonly total: WorkspaceCheckoutQuote["summary"]["total"];
      }) {
        yield* Effect.annotateLogsScoped({ providerSessionInput: input });
        yield* Effect.logInfo("Checkout provider session start requested");

        const providerTotal = withWorkspaceMoneyCurrency(
          input.total,
          getNexiCheckoutCurrencyOverride()
        );
        const nexiAmount = yield* toNexiAmount(providerTotal).pipe(
          Effect.mapError(
            (cause) =>
              new CheckoutError({
                message: "Unsupported payment amount.",
                cause,
              })
          )
        );
        yield* Effect.annotateLogsScoped({ nexiAmount });
        yield* Effect.logDebug("Checkout provider session amount encoded");

        const attempt = yield* paymentAttempts.create({
          workspaceReservationId: input.workspaceReservationId,
          providerOrderId: generateNexiOrderId(),
          amountValue: providerTotal.value,
          amountExponent: providerTotal.exponent,
          currency: providerTotal.currency,
        });
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
            notificationUrl: yield* getNotificationUrl,
            resultUrl: yield* getCheckoutOrderReturnUrl(
              input.locale,
              input.workspaceReservationId
            ),
            cancelUrl: yield* getCheckoutPaymentRetryUrl(
              input.locale,
              input.workspaceReservationId,
              "cancelled"
            ),
          })
          .pipe(
            Effect.tapError(() =>
              Effect.gen(function* () {
                const transition =
                  yield* paymentAttempts.markTerminalForReservation({
                    id: attempt.id,
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
              }).pipe(
                Effect.tapError((cause) =>
                  Effect.logWarning(
                    "Payment attempt terminal marker failed after checkout creation failure",
                    {
                      orderId: input.workspaceReservationId,
                      paymentAttemptId: attempt.id,
                      cause,
                    }
                  )
                ),
                Effect.ignore
              )
            )
          );
        yield* Effect.annotateLogsScoped({ hostedPaymentPage });
        yield* Effect.logInfo("Nexi hosted payment page creation completed");

        yield* Effect.logInfo("Checkout hosted payment page attach started");
        const attachedAttempt = yield* paymentAttempts
          .attachHostedPaymentPage({
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
          yield* Effect.logDebug(
            "Hosted payment checkout reservation lookup started",
            {
              orderId: state.orderId,
            }
          );
          const reservation = yield* reservations.findById(state.orderId);
          yield* Effect.annotateLogsScoped({ reservation });
          yield* Effect.logDebug(
            "Hosted payment checkout reservation lookup completed"
          );

          if (!reservation) {
            yield* Effect.logWarning(
              "Hosted payment checkout returned in_progress: reservation missing"
            );

            return { status: "in_progress" as const };
          }

          if (reservation.paymentState === "paid") {
            yield* Effect.logInfo(
              "Hosted payment checkout returned in_progress: reservation already paid"
            );

            return { status: "in_progress" as const };
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
              attempt.providerRedirectUrl
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
          }

          if (state.changedKeys) {
            yield* Effect.logInfo(
              "Hosted payment checkout rejected: updated price still requires review"
            );
            return yield* new CheckoutError({
              message:
                "The updated checkout price must be reviewed before payment.",
            });
          }

          const paymentAffirmation = yield* pricing.affirmForPayment({
            reservation: data,
            dotyposCustomerId: reservation.dotyposCustomerId,
            locale,
            submittedCode: state.submittedCode,
            displayedQuote: state.quote,
          });
          const quote = paymentAffirmation.quote;
          yield* Effect.annotateLogsScoped({ quote });
          yield* Effect.logDebug("Hosted payment checkout quote built");
          yield* Effect.logDebug(
            "Hosted payment checkout quote comparison started"
          );

          if (
            quote.fingerprint !== state.quote.fingerprint ||
            !workspaceMoneyEquals(quote.summary.total, state.acceptedTotal)
          ) {
            const changedKeys = getCheckoutSummaryChangedKeys(
              state.quote.summary,
              quote.summary
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
              locale,
              reservation: data,
              quote,
              orderId: reservation.id,
              submittedCode: state.submittedCode,
              changedKeys,
            });
            return {
              status: "pricing_changed" as const,
              changedKeys,
              freshSummary: quote.summary,
              freshPayUrl,
            };
          }
          yield* Effect.logDebug(
            "Hosted payment checkout quote comparison passed"
          );

          yield* reservations.updateReservationDetails({
            id: reservation.id,
            reservationDetails: getStoredCoworkReservationDetails(data),
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
          const checkoutDetails = buildCheckoutDetailsForPayment({
            locale,
            data,
            quote,
            legalEvidence,
          });
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

          if (!reservation.dotyposReservationId) {
            return yield* new CheckoutError({
              message:
                "Held reservation is missing its Dotypos reservation ID.",
            });
          }

          yield* dotypos.updateReservation({
            reservationId: reservation.dotyposReservationId,
            note: formatWorkspaceReservationNote({
              paymentOrderId: reservation.id,
              checkoutDetails: checkoutDetails as CheckoutDetailsJson,
              reservation: {
                kind: data.kind,
                ...checkoutDetails.reservation,
              },
            }),
          });
          yield* Effect.logInfo(
            "Hosted payment checkout Dotypos reservation note updated"
          );

          return yield* startProviderSession({
            workspaceReservationId: reservation.id,
            correlationId: reservation.correlationId,
            locale,
            total: quote.payment.expectedPrice,
          });
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
  Layer.provide(LegalEvidenceEventRepositoryLive),
  Layer.provide(PostHogEventServiceLive),
  Layer.provide(PaymentAttemptRepositoryLive),
  Layer.provide(WorkspaceReservationRepositoryLive),
  Layer.provide(WorkspaceDatabaseLive),
  Layer.provide(DotyposServiceLive),
  Layer.provide(NexiServiceLive),
  Layer.provide(CheckoutPricingServiceLiveWithDependencies)
);
