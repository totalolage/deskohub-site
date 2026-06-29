import { randomUUID } from "node:crypto";
import { DotyposService } from "@deskohub/dotypos";
import { NexiService } from "@deskohub/nexi";
import {
  Context,
  Data,
  Duration,
  Effect,
  Layer,
  Match,
  Predicate,
  Schema,
} from "effect";
import { WorkspaceDatabaseLive } from "@/db/database.service";
import { env } from "@/env";
import { buildFreshCheckoutPayPath } from "@/features/checkout/backend/checkout-pay-url";
import {
  type AmbiguousDotyposCustomerError,
  getConfirmedDotyposCustomerDiscount,
} from "@/features/checkout/backend/dotypos-customer-policy";
import {
  LegalEvidenceEventRepository,
  LegalEvidenceEventRepositoryLive,
} from "@/features/checkout/backend/legal-evidence-event.repository";
import { NexiAmountFromWorkspaceMoney } from "@/features/checkout/backend/nexi-amount.codec";
import { OperationalEventRepositoryLive } from "@/features/checkout/backend/operational-event.repository";
import {
  openPayState,
  type SignedPayState,
} from "@/features/checkout/backend/pay-state.server";
import {
  PaymentAttemptRepository,
  PaymentAttemptRepositoryLive,
} from "@/features/checkout/backend/payment-attempt.repository";
import {
  capturePaymentFailed,
  capturePaymentStarted,
} from "@/features/checkout/backend/posthog-lifecycle-events";
import {
  ReservationHoldCleanupService,
  ReservationHoldCleanupServiceLiveWithDependencies,
} from "@/features/checkout/backend/reservation-hold-cleanup.service";
import { ReservationHoldCleanupScheduleService } from "@/features/checkout/backend/reservation-hold-cleanup-queue.service";
import { appendVercelPreviewProtectionBypass } from "@/features/checkout/backend/vercel-preview-protection-bypass";
import {
  buildWorkspaceCheckoutQuoteEffect,
  getCheckoutSummaryChangedKeys,
  type WorkspaceCheckoutQuote,
} from "@/features/checkout/checkout-quote";
import {
  legalEvidenceMapSchema,
  paymentSubmitLegalEvidenceSource,
} from "@/features/checkout/schemas/checkout-details";
import { checkoutSummarySchema } from "@/features/checkout/schemas/checkout-summary";
import type {
  CheckoutDetailsJson,
  LegalEvidenceMap,
} from "@/features/checkout/types/checkout-details";
import { workspaceMoneyEquals } from "@/features/checkout/workspace-money";
import type { Locale } from "@/features/i18n";
import { getLegalAcceptanceSnapshot } from "@/features/legal/acceptance-snapshot";
import type { WorkspaceTableUnavailableError } from "@/features/reservation/backend/workspace-availability.service";
import {
  WorkspaceReservationRepository,
  WorkspaceReservationRepositoryLive,
} from "@/features/reservation/backend/workspace-reservation.repository";
import type { ReservationOrderData } from "@/features/reservation/schemas/reservation";
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
import { PostResponseTaskService } from "@/shared/backend/post-response-task.service";

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

export const getNexiCheckoutCurrencyOverride = () => {
  if (env.VERCEL_ENV === "production") return undefined;
  if (!env.NEXI_API_ORIGIN.includes("xpaysandbox.nexigroup.com")) {
    return undefined;
  }
  return env.NEXI_CHECKOUT_CURRENCY_OVERRIDE || undefined;
};

const getCheckoutLegalAcceptanceSnapshot: (
  locale: Locale
) => Effect.Effect<
  Awaited<ReturnType<typeof getLegalAcceptanceSnapshot>>,
  CheckoutError
> = Effect.fn("getCheckoutLegalAcceptanceSnapshot")(function* (locale) {
  return yield* Effect.tryPromise({
    try: () => getLegalAcceptanceSnapshot(locale),
    catch: (cause) =>
      new CheckoutError({
        message: "Legal acceptance snapshot could not be created.",
        cause,
      }),
  });
});

const toCheckoutLegalDocuments = (
  documents: Awaited<ReturnType<typeof getLegalAcceptanceSnapshot>>
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
  readonly legalDocuments: Awaited<
    ReturnType<typeof getLegalAcceptanceSnapshot>
  >;
}): LegalEvidenceMap => {
  const documents = toCheckoutLegalDocuments(input.legalDocuments);

  return legalEvidenceMapSchema.parse({
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
  readonly data: ReservationOrderData;
  readonly quote: WorkspaceCheckoutQuote;
  readonly legalEvidence: LegalEvidenceMap;
}): Omit<CheckoutDetailsJson, "fulfillment"> => ({
  schema: "workspace-checkout-details",
  schemaVersion: 1,
  locale: input.locale,
  reservation: {
    tier: input.data.entryTier,
    date: input.data.date,
    coffee: input.data.coffee,
    monitorOption: input.data.monitorOption,
  },
  payment: {
    expectedPrice: input.quote.payment.expectedPrice,
    summary: checkoutSummarySchema.parse(input.quote.summary),
    ...(input.quote.payment.customerDiscount && {
      undiscountedPrice:
        input.quote.payment.undiscountedPrice ??
        input.quote.payment.expectedPrice,
      customerDiscount: input.quote.payment.customerDiscount,
    }),
  },
  legal: input.legalEvidence,
});

const openFinalPayState: (
  payStateToken: string,
  locale: Locale
) => Effect.Effect<SignedPayState, CheckoutError> = Effect.fn(
  "openFinalPayState"
)(function* (payStateToken, locale) {
  const state = yield* Effect.try({
    try: () => openPayState(payStateToken),
    catch: (cause) =>
      new CheckoutError({
        message:
          "Pay state is invalid or expired. Please review checkout again.",
        cause,
      }),
  });

  if (state.locale !== locale) {
    return yield* Effect.fail(
      new CheckoutError({
        message: "Pay state locale does not match this checkout session.",
      })
    );
  }

  return state;
});

const getFreshPayUrl: (input: {
  readonly locale: Locale;
  readonly reservation: ReservationOrderData;
  readonly quote: WorkspaceCheckoutQuote;
  readonly orderId: string;
  readonly changedKeys: ReturnType<typeof getCheckoutSummaryChangedKeys>;
}) => Effect.Effect<string, CheckoutError> = Effect.fn("getFreshPayUrl")(
  (input) => Effect.succeed(buildFreshCheckoutPayPath(input))
);

type MappableCheckoutFailure =
  | CheckoutError
  | AmbiguousDotyposCustomerError
  | WorkspaceTableUnavailableError;

const isMappableCheckoutFailure = (
  cause: unknown
): cause is MappableCheckoutFailure =>
  Predicate.isTagged(cause, "CheckoutError") ||
  Predicate.isTagged(cause, "AmbiguousDotyposCustomerError") ||
  Predicate.isTagged(cause, "WorkspaceTableUnavailableError");

const mapCheckoutFailure = (cause: unknown) => {
  if (isMappableCheckoutFailure(cause)) {
    return Match.value(cause).pipe(
      Match.tag("CheckoutError", (error) => error),
      Match.tag(
        "AmbiguousDotyposCustomerError",
        (error) => new CheckoutError({ message: error.message, cause: error })
      ),
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
    const holdCleanup = yield* ReservationHoldCleanupService;
    const cleanupSchedule = yield* ReservationHoldCleanupScheduleService;
    const postResponseTasks = yield* PostResponseTaskService;
    const posthogEvents = yield* PostHogEventService;

    const scheduleHoldCleanup = Effect.fn("checkout.scheduleHoldCleanup")(
      function* (input: {
        readonly orderId: string;
        readonly reservationHoldExpiresAt: Date | null;
      }) {
        if (!input.reservationHoldExpiresAt) return;

        const enqueue = cleanupSchedule
          .enqueueCleanup({
            orderId: input.orderId,
            reservationHoldExpiresAt: input.reservationHoldExpiresAt,
          })
          .pipe(
            Effect.tapError((cause) =>
              Effect.logWarning("Checkout cleanup schedule enqueue failed", {
                orderId: input.orderId,
                cause,
              })
            )
          );

        yield* postResponseTasks.run(
          enqueue.pipe(
            Effect.timeoutOrElse({
              duration: Duration.seconds(30),
              orElse: () =>
                Effect.logWarning(
                  "Checkout cleanup schedule enqueue timed out",
                  {
                    orderId: input.orderId,
                  }
                ),
            }),
            Effect.ignore
          )
        );
      }
    );

    const startProviderSession = Effect.fn("checkout.startProviderSession")(
      function* (input: {
        readonly workspaceReservationId: string;
        readonly reservationHoldExpiresAt: Date | null;
        readonly correlationId: string;
        readonly locale: Locale;
        readonly total: WorkspaceCheckoutQuote["summary"]["total"];
      }) {
        yield* Effect.annotateLogsScoped({ providerSessionInput: input });
        yield* Effect.logInfo("Checkout provider session start requested");

        const nexiAmount = yield* toNexiAmount(input.total).pipe(
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
          amountValue: input.total.value,
          amountExponent: input.total.exponent,
          currency: input.total.currency,
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
        yield* scheduleHoldCleanup({
          orderId: input.workspaceReservationId,
          reservationHoldExpiresAt: input.reservationHoldExpiresAt,
        });
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

            return yield* Effect.fail(
              new CheckoutError({
                message: "Legal consent is required before checkout.",
              })
            );
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
            reservation.reservationHoldExpiresAt <= new Date()
          ) {
            yield* holdCleanup
              .cancelOrderHold({
                orderId: reservation.id,
                holdExpiredAt: new Date(),
              })
              .pipe(
                Effect.tapError((cause) =>
                  Effect.logWarning(
                    "Checkout expired hold cancellation failed",
                    {
                      orderId: reservation.id,
                      cause,
                    }
                  )
                ),
                Effect.ignore
              );
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
              yield* scheduleHoldCleanup({
                orderId: reservation.id,
                reservationHoldExpiresAt: reservation.reservationHoldExpiresAt,
              });

              return {
                status: "redirect" as const,
                redirectUrl: attempt.providerRedirectUrl,
              };
            }
          }

          const customerDiscount = yield* getConfirmedDotyposCustomerDiscount(
            data
          ).pipe(Effect.provideService(DotyposService, dotypos));
          const quote = yield* buildWorkspaceCheckoutQuoteEffect(data, {
            customerDiscount,
            currencyOverride: getNexiCheckoutCurrencyOverride(),
          });
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

          yield* reservations.updateProductIntent({
            id: reservation.id,
            productTier: data.entryTier,
            productCoffee: data.coffee,
            productMonitorOption: data.monitorOption,
            locale,
          });

          const acceptedAt = new Date().toISOString();
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

          return yield* startProviderSession({
            workspaceReservationId: reservation.id,
            reservationHoldExpiresAt: reservation.reservationHoldExpiresAt,
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
  Layer.provide(PostResponseTaskService.Live),
  Layer.provide(ReservationHoldCleanupScheduleService.Live),
  Layer.provide(ReservationHoldCleanupServiceLiveWithDependencies),
  Layer.provide(OperationalEventRepositoryLive),
  Layer.provide(LegalEvidenceEventRepositoryLive),
  Layer.provide(PostHogEventServiceLive),
  Layer.provide(PaymentAttemptRepositoryLive),
  Layer.provide(WorkspaceReservationRepositoryLive),
  Layer.provide(WorkspaceDatabaseLive),
  Layer.provide(DotyposServiceLive),
  Layer.provide(NexiServiceLive)
);
