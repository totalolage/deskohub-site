import { randomUUID } from "node:crypto";
import { DotyposService } from "@deskohub/dotypos";
import { ValidationError as DotyposValidationError } from "@deskohub/dotypos/errors";
import { NexiApi, NexiService } from "@deskohub/nexi";
import { Context, Data, Effect, Layer, Schema } from "effect";
import { WorkspaceDatabaseLive } from "@/db/database.service";
import { env } from "@/env";
import { buildFreshCheckoutPayPath } from "@/features/checkout/backend/checkout-pay-url";
import {
  CheckoutReturnStateTokenRepository,
  CheckoutReturnStateTokenRepositoryLive,
} from "@/features/checkout/backend/checkout-return-state-token.repository";
import {
  AmbiguousDotyposCustomerError,
  getConfirmedDotyposCustomerDiscount,
  splitCustomerName,
} from "@/features/checkout/backend/dotypos-customer-policy";
import { NexiAmountFromWorkspaceMoney } from "@/features/checkout/backend/nexi-amount.codec";
import {
  openPayState,
  type SignedPayState,
} from "@/features/checkout/backend/pay-state.server";
import {
  PaymentOrderRepository,
  PaymentOrderRepositoryLive,
} from "@/features/checkout/backend/payment-order.repository";
import { appendVercelPreviewProtectionBypass } from "@/features/checkout/backend/vercel-preview-protection-bypass";
import {
  buildWorkspaceCheckoutQuote,
  getCheckoutSummaryChangedKeys,
  type WorkspaceCheckoutQuote,
} from "@/features/checkout/checkout-quote";
import { appendCheckoutReturnStateToken } from "@/features/checkout/schemas/checkout-return-state-token";
import type { Locale } from "@/features/i18n";
import { getLegalAcceptanceSnapshot } from "@/features/legal/acceptance-snapshot";
import type { ReservationOrderData } from "@/features/reservation/schemas/reservation";
import { DotyposRuntimeConfigLive } from "@/shared/backend/config/dotypos.config";
import { NexiRuntimeConfigLive } from "@/shared/backend/config/nexi.config";
import {
  getWorkspaceRuntimeCallbackOrigin,
  type WorkspaceUrlConfigError,
} from "@/shared/backend/config/workspace-url.config";

type CheckoutLegalEvidence = {
  readonly acceptedAt: string;
  readonly locale: Locale;
  readonly source: "workspace-pay-final-submit";
  readonly documents: ReturnType<typeof toCheckoutLegalDocuments>;
  readonly acknowledgements: {
    readonly termsAndConditions: true;
    readonly operatingRules: true;
    readonly noRefundAfterPinDelivery: true;
    readonly privacyPolicy: true;
  };
};

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
}): CheckoutLegalEvidence => ({
  acceptedAt: input.acceptedAt,
  locale: input.locale,
  source: "workspace-pay-final-submit",
  documents: toCheckoutLegalDocuments(input.legalDocuments),
  acknowledgements: {
    termsAndConditions: true,
    operatingRules: true,
    noRefundAfterPinDelivery: true,
    privacyPolicy: true,
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
    const nexi = yield* NexiService;
    const paymentOrders = yield* PaymentOrderRepository;
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

    return CheckoutService.of({
      createHostedPaymentCheckout: Effect.fn(
        "checkout.createHostedPaymentCheckout"
      )(
        function* (input, locale) {
          const correlationId = randomUUID();

          yield* Effect.annotateLogsScoped({ correlationId });

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
                  orderId: randomUUID(),
                  changedKeys,
                });

                return {
                  status: "pricing_changed" as const,
                  changedKeys,
                  freshSummary: quote.summary,
                  freshPayUrl,
                };
              }

              return yield* startProviderSession({
                orderId: existingOrder.id,
                correlationId,
                locale,
                data,
                total: quote.payment.expectedPrice,
              });
            }

            if (!isActivePaymentStatus(existingOrder.paymentStatus)) {
              const customerDiscount =
                yield* getConfirmedDotyposCustomerDiscount(data).pipe(
                  Effect.provideService(DotyposService, dotypos)
                );
              const quote = buildWorkspaceCheckoutQuote(data, {
                customerDiscount,
                currencyOverride: getNexiCheckoutCurrencyOverride(),
              });
              const changedKeys = getCheckoutSummaryChangedKeys(
                state.quote.summary,
                quote.summary
              );
              const freshPayUrl = yield* getFreshPayUrl({
                locale,
                reservation: data,
                quote,
                orderId: randomUUID(),
                changedKeys,
              });

              return {
                status: "pricing_changed" as const,
                changedKeys,
                freshSummary: quote.summary,
                freshPayUrl,
              };
            }

            return { status: "in_progress" as const };
          }

          const customerName = splitCustomerName(data.name);
          const customerDiscount = yield* getConfirmedDotyposCustomerDiscount(
            data
          ).pipe(Effect.provideService(DotyposService, dotypos));
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
              orderId,
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

          const customer = yield* dotypos.findOrCreateCustomer(
            {
              ...customerName,
              email: data.email,
              phone: data.phone || undefined,
            },
            {
              lookupFields: ["email"],
            }
          );
          const dotyposCustomerId = yield* getDotyposCustomerId(customer);
          const baseCheckoutPrice =
            quote.payment.undiscountedPrice ?? quote.payment.expectedPrice;
          const checkoutPrice = quote.payment.expectedPrice;
          const order = yield* paymentOrders.create({
            id: orderId,
            dotyposCustomerId,
            correlationId,
            checkoutDetails: {
              schema: "workspace-checkout-details",
              schemaVersion: 1,
              locale,
              reservation: {
                tier: data.entryTier,
                date: data.date,
                coffee: data.coffee,
                monitorOption: data.monitorOption,
              },
              payment: {
                expectedPrice: checkoutPrice,
                quoteFingerprint: quote.fingerprint,
                summary: quote.summary,
                ...(quote.payment.customerDiscount && {
                  undiscountedPrice: baseCheckoutPrice,
                  customerDiscount: quote.payment.customerDiscount,
                }),
              },
              legal: legalEvidence,
            },
          });

          const existingRedirectUrl =
            order.checkoutDetails.payment.providerRedirectUrl;
          if (
            isActivePaymentStatus(order.paymentStatus) &&
            order.securityToken &&
            existingRedirectUrl
          ) {
            return {
              status: "redirect" as const,
              redirectUrl: existingRedirectUrl,
            };
          }

          if (
            order.paymentStatus !== "created" ||
            order.securityToken ||
            order.lastProviderStatus
          ) {
            return { status: "in_progress" as const };
          }

          const result = yield* startProviderSession({
            orderId: order.id,
            correlationId,
            locale,
            data,
            total: checkoutPrice,
          });

          yield* Effect.logInfo("Workspace checkout payment pending", {
            locale,
            entryTier: data.entryTier,
            orderId: order.id,
          });

          return result;
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
