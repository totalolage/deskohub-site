import { randomUUID } from "node:crypto";
import { DotyposService } from "@deskohub/dotypos";
import { ValidationError as DotyposValidationError } from "@deskohub/dotypos/errors";
import { NexiApi, NexiService } from "@deskohub/nexi";
import { Context, Data, Effect, Layer, Schema } from "effect";
import { WorkspaceDatabaseLive } from "@/db/database.service";
import type { PaymentOrder } from "@/db/schema";
import { env } from "@/env";
import { buildFreshCheckoutPayPath } from "@/features/checkout/backend/checkout-pay-url";
import {
  CheckoutReturnStateTokenRepository,
  CheckoutReturnStateTokenRepositoryLive,
} from "@/features/checkout/backend/checkout-return-state-token.repository";
import {
  AmbiguousDotyposCustomerError,
  getConfirmedDotyposCustomerDiscount,
} from "@/features/checkout/backend/dotypos-customer-policy";
import { createWorkspaceDotyposReservation } from "@/features/checkout/backend/dotypos-reservation.adapter";
import { NexiAmountFromWorkspaceMoney } from "@/features/checkout/backend/nexi-amount.codec";
import {
  openPayState,
  type SignedPayState,
} from "@/features/checkout/backend/pay-state.server";
import {
  PaymentOrderRepository,
  PaymentOrderRepositoryLive,
} from "@/features/checkout/backend/payment-order.repository";
import {
  ReservationHoldCleanupService,
  ReservationHoldCleanupServiceLive,
} from "@/features/checkout/backend/reservation-hold-cleanup.service";
import { appendVercelPreviewProtectionBypass } from "@/features/checkout/backend/vercel-preview-protection-bypass";
import {
  buildWorkspaceCheckoutQuote,
  getCheckoutSummaryChangedKeys,
  type WorkspaceCheckoutQuote,
} from "@/features/checkout/checkout-quote";
import { appendCheckoutReturnStateToken } from "@/features/checkout/schemas/checkout-return-state-token";
import {
  legalEvidenceMapSchema,
  paymentSubmitLegalEvidenceSource,
} from "@/features/checkout/schemas/checkout-details";
import type { LegalEvidenceMap } from "@/features/checkout/types/checkout-details";
import type { CheckoutDetailsJson } from "@/features/checkout/types/checkout-details";
import type { Locale } from "@/features/i18n";
import {
  WorkspaceAvailabilityService,
  WorkspaceAvailabilityServiceLive,
  WorkspaceTableUnavailableError,
} from "@/features/reservation/backend/workspace-availability.service";
import {
  WorkspaceTableAssignmentService,
  WorkspaceTableAssignmentServiceLive,
} from "@/features/checkout/backend/workspace-table-assignment.service";
import { getLegalAcceptanceSnapshot } from "@/features/legal/acceptance-snapshot";
import type { ReservationOrderData } from "@/features/reservation/schemas/reservation";
import { DotyposRuntimeConfigLive } from "@/shared/backend/config/dotypos.config";
import { NexiRuntimeConfigLive } from "@/shared/backend/config/nexi.config";
import {
  getWorkspaceRuntimeCallbackOrigin,
  type WorkspaceUrlConfigError,
} from "@/shared/backend/config/workspace-url.config";

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
  Context.GenericTag<CheckoutService>("CheckoutService");

const toCheckoutUrlError = (cause: WorkspaceUrlConfigError) =>
  Effect.fail(
    new CheckoutError({
      message: cause.message,
      cause,
    })
  );

const getCheckoutOrderReturnUrl: (
  locale: Locale,
  orderId: string,
  checkoutToken: string
) => Effect.Effect<string, CheckoutError> = Effect.fn(
  "getCheckoutOrderReturnUrl"
)(
  function* (locale, orderId, checkoutToken) {
    const origin = yield* getWorkspaceRuntimeCallbackOrigin;

    return yield* Effect.try({
      try: () => {
        const url = new URL(`/${locale}/checkout/result/${orderId}`, origin);
        appendCheckoutReturnStateToken(url, checkoutToken);
        appendVercelPreviewProtectionBypass(url);
        return url.toString();
      },
      catch: (cause) =>
        new CheckoutError({
          message: "Payment checkout return URL could not be created.",
          cause,
        }),
    });
  },
  (effect, locale, orderId) =>
    effect.pipe(
      Effect.annotateLogs({
        locale,
        orderId,
      }),
      Effect.catchTag("WorkspaceUrlConfigError", toCheckoutUrlError)
    )
);

const getCheckoutPaymentRetryUrl: (
  locale: Locale,
  orderId: string,
  outcome: "cancelled",
  checkoutToken: string
) => Effect.Effect<string, CheckoutError> = Effect.fn(
  "getCheckoutPaymentRetryUrl"
)(
  function* (locale, orderId, outcome, checkoutToken) {
    const origin = yield* getWorkspaceRuntimeCallbackOrigin;

    return yield* Effect.try({
      try: () => {
        const url = new URL(`/${locale}/checkout/payment/${orderId}`, origin);
        url.searchParams.set("outcome", outcome);
        appendCheckoutReturnStateToken(url, checkoutToken);
        appendVercelPreviewProtectionBypass(url);
        return url.toString();
      },
      catch: (cause) =>
        new CheckoutError({
          message: "Payment checkout retry URL could not be created.",
          cause,
        }),
    });
  },
  (effect, locale, orderId, outcome) =>
    effect.pipe(
      Effect.annotateLogs({
        locale,
        orderId,
        outcome,
      }),
      Effect.catchTag("WorkspaceUrlConfigError", toCheckoutUrlError)
    )
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

const toNexiAmount = Schema.encode(NexiAmountFromWorkspaceMoney);

export const getNexiCheckoutCurrencyOverride = () => {
  if (env.VERCEL_ENV === "production") return undefined;
  if (!env.NEXI_API_ORIGIN.includes("xpaysandbox.nexigroup.com"))
    return undefined;
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

const getDotyposCustomerId: (customer: {
  readonly id?: string | null;
}) => Effect.Effect<string, DotyposValidationError> = Effect.fn(
  "getDotyposCustomerId"
)(function* (customer) {
  if (!customer.id) {
    return yield* new DotyposValidationError({
      message: "Dotypos customer was created without an ID",
    });
  }

  return customer.id;
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
  privacyPolicy: {
    path: documents.privacyPolicy.path,
    hash: documents.privacyPolicy.hash,
    hashAlgorithm: documents.privacyPolicy.hashAlgorithm,
  },
});

const getFreshPayUrl: (input: {
  readonly locale: Locale;
  readonly reservation: ReservationOrderData;
  readonly quote: WorkspaceCheckoutQuote;
  readonly orderId: string;
  readonly changedKeys: ReturnType<typeof getCheckoutSummaryChangedKeys>;
}) => Effect.Effect<string, CheckoutError> = Effect.fn("getFreshPayUrl")(
  function* (input) {
    const payPath = buildFreshCheckoutPayPath({
      locale: input.locale,
      reservation: input.reservation,
      quote: input.quote,
      orderId: input.orderId,
      changedKeys: input.changedKeys,
    });

    if (!payPath) {
      return yield* Effect.fail(
        new CheckoutError({
          message: "Updated Pay state was too large to continue checkout.",
        })
      );
    }

    return payPath;
  }
);

const isActivePaymentStatus = (status: string) =>
  status === "created" || status === "payment_pending";

const isUnsuccessfulTerminalPaymentStatus = (status: string) =>
  status === "payment_failed" || status === "cancelled" || status === "expired";

const moneyEquals = (
  left: WorkspaceCheckoutQuote["summary"]["total"],
  right: WorkspaceCheckoutQuote["summary"]["total"]
) =>
  left.value === right.value &&
  left.currency === right.currency &&
  left.exponent === right.exponent;

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
      acknowledgements: {
        noRefundAfterPinDelivery: true,
      },
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
    quoteFingerprint: input.quote.fingerprint,
    summary: input.quote.summary,
    ...(input.quote.payment.customerDiscount && {
      undiscountedPrice:
        input.quote.payment.undiscountedPrice ?? input.quote.payment.expectedPrice,
      customerDiscount: input.quote.payment.customerDiscount,
    }),
  },
  legal: input.legalEvidence,
});

const buildCheckoutDetailsWithCurrentQuote = (input: {
  readonly existing: PaymentOrder;
  readonly data: ReservationOrderData;
  readonly quote: WorkspaceCheckoutQuote;
}): Omit<CheckoutDetailsJson, "fulfillment"> => ({
  ...input.existing.checkoutDetails,
  reservation: {
    tier: input.data.entryTier,
    date: input.data.date,
    coffee: input.data.coffee,
    monitorOption: input.data.monitorOption,
  },
  payment: {
    expectedPrice: input.quote.payment.expectedPrice,
    quoteFingerprint: input.quote.fingerprint,
    summary: input.quote.summary,
    ...(input.quote.payment.customerDiscount && {
      undiscountedPrice:
        input.quote.payment.undiscountedPrice ?? input.quote.payment.expectedPrice,
      customerDiscount: input.quote.payment.customerDiscount,
    }),
  },
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

const mapCheckoutFailure = (cause: unknown) => {
  if (cause instanceof CheckoutError) {
    return cause;
  }

  if (cause instanceof AmbiguousDotyposCustomerError) {
    return new CheckoutError({ message: cause.message, cause });
  }

  if (cause instanceof WorkspaceTableUnavailableError) {
    return new CheckoutError({ message: "workspace_table_unavailable", cause });
  }

  return new CheckoutError({
    message:
      "Payment checkout could not be started. Please review your details and try again.",
    cause,
  });
};

export const CheckoutServiceLive = Layer.effect(
  CheckoutService,
  Effect.gen(function* () {
    const dotypos = yield* DotyposService;
    const availability = yield* WorkspaceAvailabilityService;
    const nexi = yield* NexiService;
    const paymentOrders = yield* PaymentOrderRepository;
    const holdCleanup = yield* ReservationHoldCleanupService;
    const tableAssignments = yield* WorkspaceTableAssignmentService;
    const checkoutReturnStateTokens = yield* CheckoutReturnStateTokenRepository;

    const startProviderSession = Effect.fn("checkout.startProviderSession")(
      function* (input: {
        readonly orderId: string;
        readonly correlationId: string;
        readonly locale: Locale;
        readonly data: ReservationOrderData;
        readonly total: WorkspaceCheckoutQuote["summary"]["total"];
      }) {
        const claimed = yield* paymentOrders.claimNexiSessionCreation(
          input.orderId
        );

        if (!claimed) {
          const order = yield* paymentOrders.findById(input.orderId);
          const redirectUrl =
            order?.checkoutDetails.payment.providerRedirectUrl;

          if (
            order &&
            isActivePaymentStatus(order.paymentStatus) &&
            order.securityToken &&
            redirectUrl
          ) {
            return { status: "redirect" as const, redirectUrl };
          }

          return { status: "in_progress" as const };
        }

        const nexiAmount = yield* toNexiAmount(input.total).pipe(
          Effect.mapError(
            (cause) =>
              new CheckoutError({
                message: "Unsupported payment amount.",
                cause,
              })
          )
        );
        const checkoutToken = yield* checkoutReturnStateTokens.create({
          paymentOrderId: input.orderId,
          state: {
            schema: "workspace-checkout-return-state",
            schemaVersion: 1,
            reservation: {
              entryTier: input.data.entryTier,
              date: input.data.date,
              coffee: input.data.coffee,
              monitorOption: input.data.monitorOption,
              name: input.data.name,
              email: input.data.email,
              phone: input.data.phone,
              message: input.data.message,
            },
          },
        });
        const hostedPaymentPage = yield* nexi
          .createHostedPaymentPage({
            orderId: input.orderId,
            correlationId: input.correlationId,
            amount: nexiAmount.amount,
            currency: nexiAmount.currency,
            locale: input.locale,
            notificationUrl: yield* getNotificationUrl,
            resultUrl: yield* getCheckoutOrderReturnUrl(
              input.locale,
              input.orderId,
              checkoutToken
            ),
            cancelUrl: yield* getCheckoutPaymentRetryUrl(
              input.locale,
              input.orderId,
              "cancelled",
              checkoutToken
            ),
          })
          .pipe(
            Effect.tapError((cause) =>
              paymentOrders
                .markFailed({
                  id: input.orderId,
                  failureCode: "nexi_hpp_create_failed",
                  providerStatus: "hpp_create_failed",
                })
                .pipe(
                  Effect.catchAll((cleanupCause) =>
                    Effect.logError(
                      "Failed to mark checkout order after Nexi HPP creation failure",
                      { cleanupCause, originalCause: cause }
                    )
                  )
                )
            )
          );

        yield* paymentOrders.attachNexiSession({
          id: input.orderId,
          securityToken: hostedPaymentPage.securityToken,
          providerOperationId: hostedPaymentPage.orderId,
          providerStatus: "hpp_created",
          providerRedirectUrl: hostedPaymentPage.hostedPage,
        });
        yield* paymentOrders.markPaymentPending(input.orderId);

        return {
          status: "redirect" as const,
          redirectUrl: hostedPaymentPage.hostedPage,
        };
      }
    );

    const ensureNewHold = Effect.fn("checkout.ensureNewHold")(
      function* (input: {
        readonly order: PaymentOrder | null;
      }) {
        const order = input.order;
        if (!order) return null;

        if (
          order.dotyposReservationStatus === "NEW" &&
          order.dotyposReservationId &&
          (!order.reservationHoldExpiresAt ||
            order.reservationHoldExpiresAt > new Date())
        ) {
          return order;
        }

        if (
          order.dotyposReservationStatus === "NEW" &&
          order.dotyposReservationId
        ) {
          yield* holdCleanup.cancelOrderHold({
            orderId: order.id,
            holdExpiredAt: new Date(),
          });
        }

        const currentOrder = yield* paymentOrders.findById(order.id);
        if (!currentOrder) return null;
        if (
          currentOrder.dotyposReservationStatus === "NEW" &&
          currentOrder.dotyposReservationId
        ) {
          return currentOrder;
        }
        if (currentOrder.dotyposReservationStatus === "cancellation_pending") {
          return null;
        }

        const claimed = yield* paymentOrders.claimReservationCreation(
          currentOrder.id
        );
        if (!claimed) return null;

        const reservation = yield* createWorkspaceDotyposReservation({
          paymentOrderId: currentOrder.id,
          dotyposCustomerId: currentOrder.dotyposCustomerId,
          checkoutDetails: currentOrder.checkoutDetails,
          status: "NEW",
        }).pipe(
          Effect.provideService(DotyposService, dotypos),
          Effect.provideService(WorkspaceTableAssignmentService, tableAssignments),
          Effect.catchAll((cause) =>
            paymentOrders.releaseReservationCreation(currentOrder.id).pipe(
              Effect.ignore,
              Effect.zipRight(Effect.fail(cause))
            )
          )
        );

        if (!reservation.id) {
          yield* paymentOrders.releaseReservationCreation(currentOrder.id).pipe(
            Effect.ignore
          );
          return yield* new DotyposValidationError({
            message: "Dotypos reservation was created without an ID",
          });
        }

        yield* paymentOrders.attachNewReservationHold({
          id: currentOrder.id,
          dotyposReservationId: reservation.id,
          reservationCreatedAt: new Date(),
        });

        return yield* paymentOrders.findById(currentOrder.id);
      }
    );

    return CheckoutService.of({
      createHostedPaymentCheckout: Effect.fn(
        "checkout.createHostedPaymentCheckout"
      )(
        function* (input, locale) {
          const correlationId = randomUUID();

          yield* Effect.annotateLogsScoped({ correlationId });
          yield* holdCleanup
            .sweepExpiredHolds({ now: new Date(), limit: 10 })
            .pipe(Effect.ignore);

          if (input.legalConsent !== true) {
            return yield* Effect.fail(
              new CheckoutError({
                message: "Legal consent is required before checkout.",
              })
            );
          }

          const state = yield* openFinalPayState(input.payStateToken, locale);
          const data = state.reservation;
          const orderId = state.orderId;

          const existingOrder = yield* paymentOrders.findById(orderId);
          if (existingOrder) {
            const redirectUrl =
              existingOrder.checkoutDetails.payment.providerRedirectUrl;
            if (
              isActivePaymentStatus(existingOrder.paymentStatus) &&
              existingOrder.securityToken &&
              redirectUrl
            ) {
              return { status: "redirect" as const, redirectUrl };
            }

            if (
              existingOrder.paymentStatus === "created" &&
              !existingOrder.securityToken &&
              !existingOrder.lastProviderStatus
            ) {
              if (
                existingOrder.dotyposReservationStatus !== "NEW" ||
                !existingOrder.dotyposReservationId
              ) {
                return { status: "in_progress" as const };
              }

              if (
                existingOrder.reservationHoldExpiresAt &&
                existingOrder.reservationHoldExpiresAt <= new Date()
              ) {
                return { status: "in_progress" as const };
              }

              const customerDiscount =
                yield* getConfirmedDotyposCustomerDiscount(data).pipe(
                  Effect.provideService(DotyposService, dotypos)
                );
              const quote = buildWorkspaceCheckoutQuote(data, {
                customerDiscount,
                currencyOverride: getNexiCheckoutCurrencyOverride(),
              });

              if (
                quote.fingerprint !==
                  existingOrder.checkoutDetails.payment.quoteFingerprint ||
                !moneyEquals(
                  quote.summary.total,
                  existingOrder.checkoutDetails.payment.expectedPrice
                ) ||
                quote.fingerprint !== state.quote.fingerprint ||
                !moneyEquals(quote.summary.total, state.acceptedTotal)
              ) {
                const changedKeys = getCheckoutSummaryChangedKeys(
                  state.quote.summary,
                  quote.summary
                );
                const freshPayUrl = yield* getFreshPayUrl({
                  locale,
                  reservation: data,
                  quote,
                  orderId: existingOrder.id,
                  changedKeys,
                });
                yield* paymentOrders.updateCheckoutDetails({
                  id: existingOrder.id,
                  checkoutDetails: buildCheckoutDetailsWithCurrentQuote({
                    existing: existingOrder,
                    data,
                    quote,
                  }),
                });

                return {
                  status: "pricing_changed" as const,
                  changedKeys,
                  freshSummary: quote.summary,
                  freshPayUrl,
                };
              }

              const acceptedAt = new Date().toISOString();
              const legalDocuments =
                yield* getCheckoutLegalAcceptanceSnapshot(locale);
              const legalEvidence = getCheckoutLegalEvidence({
                acceptedAt,
                locale,
                legalDocuments,
              });
              yield* paymentOrders.updateCheckoutDetails({
                id: existingOrder.id,
                checkoutDetails: buildCheckoutDetailsForPayment({
                  locale,
                  data,
                  quote,
                  legalEvidence,
                }),
              });

              return yield* startProviderSession({
                orderId: existingOrder.id,
                correlationId,
                locale,
                data,
                total: quote.payment.expectedPrice,
              });
            }

            if (isUnsuccessfulTerminalPaymentStatus(existingOrder.paymentStatus)) {
              const customerDiscount =
                yield* getConfirmedDotyposCustomerDiscount(data).pipe(
                  Effect.provideService(DotyposService, dotypos)
                );
              const quote = buildWorkspaceCheckoutQuote(data, {
                customerDiscount,
                currencyOverride: getNexiCheckoutCurrencyOverride(),
              });

              if (
                quote.fingerprint !== state.quote.fingerprint ||
                !moneyEquals(quote.summary.total, state.acceptedTotal)
              ) {
                const changedKeys = getCheckoutSummaryChangedKeys(
                  state.quote.summary,
                  quote.summary
                );
                const freshPayUrl = yield* getFreshPayUrl({
                  locale,
                  reservation: data,
                  quote,
                  orderId: existingOrder.id,
                  changedKeys,
                });

                return {
                  status: "pricing_changed" as const,
                  changedKeys,
                  freshSummary: quote.summary,
                  freshPayUrl,
                };
              }

              const acceptedAt = new Date().toISOString();
              const legalDocuments =
                yield* getCheckoutLegalAcceptanceSnapshot(locale);
              const legalEvidence = getCheckoutLegalEvidence({
                acceptedAt,
                locale,
                legalDocuments,
              });
              const retryOrder = yield* paymentOrders.resetUnsuccessfulForRetry({
                id: existingOrder.id,
                correlationId,
                checkoutDetails: buildCheckoutDetailsForPayment({
                  locale,
                  data,
                  quote,
                  legalEvidence,
                }),
              });
              const heldOrder = yield* ensureNewHold({ order: retryOrder }).pipe(
                Effect.catchAll(() => Effect.succeed(null))
              );

              if (!heldOrder) return { status: "in_progress" as const };

              return yield* startProviderSession({
                orderId: heldOrder.id,
                correlationId,
                locale,
                data,
                total: quote.payment.expectedPrice,
              });
            }

            if (!isActivePaymentStatus(existingOrder.paymentStatus)) {
              return { status: "in_progress" as const };
            }

            return { status: "in_progress" as const };
          }

          return { status: "in_progress" as const };
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
  Layer.provide(WorkspaceAvailabilityServiceLive),
  Layer.provide(WorkspaceTableAssignmentServiceLive),
  Layer.provide(ReservationHoldCleanupServiceLive),
  Layer.provide(CheckoutReturnStateTokenRepositoryLive),
  Layer.provide(PaymentOrderRepositoryLive),
  Layer.provide(WorkspaceDatabaseLive),
  Layer.provide(
    Layer.provide(DotyposService.Default, DotyposRuntimeConfigLive)
  ),
  Layer.provide(
    Layer.provide(
      NexiService.Default,
      Layer.provide(NexiApi.Default, NexiRuntimeConfigLive)
    )
  ),
  Layer.orDie
);
