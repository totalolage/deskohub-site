import { randomUUID } from "node:crypto";
import { DotyposService } from "@deskohub/dotypos";
import { ValidationError as DotyposValidationError } from "@deskohub/dotypos/errors";
import { NexiApi, NexiService } from "@deskohub/nexi";
import { Context, Data, Effect, Layer, Schema } from "effect";
import { WorkspaceDatabaseLive } from "@/db/database.service";
import { NexiAmountFromWorkspaceMoney } from "@/features/checkout/backend/nexi-amount.codec";
import {
  PaymentOrderRepository,
  PaymentOrderRepositoryLive,
} from "@/features/checkout/backend/payment-order.repository";
import { getWorkspaceProductByTier } from "@/features/checkout/product-catalog";
import type { Locale } from "@/features/i18n";
import { getLegalAcceptanceSnapshot } from "@/features/legal/acceptance-snapshot";
import type { ReservationData } from "@/features/reservation/schemas/reservation";
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
    data: ReservationData,
    locale: Locale
  ) => Effect.Effect<{ readonly redirectUrl: string }, CheckoutError>;
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

const getCheckoutStatusUrl: (
  locale: Locale,
  orderId: string,
  outcome: "success" | "cancelled"
) => Effect.Effect<string, CheckoutError> = Effect.fn("getCheckoutStatusUrl")(
  function* (locale, orderId, outcome) {
    const origin = yield* getWorkspaceRuntimeCallbackOrigin;

    return yield* Effect.try({
      try: () => {
        const url = new URL(`/${locale}/checkout/status/${orderId}`, origin);
        url.searchParams.set("outcome", outcome);
        return url.toString();
      },
      catch: (cause) =>
        new CheckoutError({
          message: "Payment checkout status URL could not be created.",
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
      try: () => new URL("/api/webhooks/nexi", origin).toString(),
      catch: (cause) =>
        new CheckoutError({
          message: "Payment checkout notification URL could not be created.",
          cause,
        }),
    });
  }
).pipe(Effect.catchTag("WorkspaceUrlConfigError", toCheckoutUrlError));

const toNexiAmount = Schema.encode(NexiAmountFromWorkspaceMoney);

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

const splitName = (name: string) => {
  const [firstName = "", ...lastNameParts] = name.trim().split(/\s+/);
  return {
    firstName,
    lastName: lastNameParts.join(" ") || undefined,
  };
};

const mapCheckoutFailure = (cause: unknown) => {
  if (cause instanceof CheckoutError) {
    return cause;
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

    return CheckoutService.of({
      createHostedPaymentCheckout: Effect.fn(
        "checkout.createHostedPaymentCheckout"
      )(
        function* (data, locale) {
          const correlationId = randomUUID();

          yield* Effect.annotateLogsScoped({ correlationId });

          if (data.legalConsent !== true) {
            return yield* Effect.fail(
              new CheckoutError({
                message: "Legal consent is required before checkout.",
              })
            );
          }

          const product = getWorkspaceProductByTier(data.entryTier);
          const orderId = randomUUID();
          const acceptedAt = new Date().toISOString();
          const legalConsent = data.legalConsent;
          const legalDocuments =
            yield* getCheckoutLegalAcceptanceSnapshot(locale);
          const customerName = splitName(data.name);
          const customer = yield* dotypos.findOrCreateCustomer({
            ...customerName,
            email: data.email,
            phone: data.phone || undefined,
          });
          const dotyposCustomerId = yield* getDotyposCustomerId(customer);
          const nexiAmount = yield* toNexiAmount(product.price).pipe(
            Effect.mapError(
              (cause) =>
                new CheckoutError({
                  message: "Unsupported payment amount.",
                  cause,
                })
            )
          );

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
                message: data.message,
              },
              payment: {
                expectedPrice: product.price,
              },
              legal: {
                acceptedAt,
                documents: toCheckoutLegalDocuments(legalDocuments),
                acknowledgements: {
                  termsAndConditions: legalConsent,
                  operatingRules: legalConsent,
                  noRefundAfterPinDelivery: legalConsent,
                  privacyPolicy: legalConsent,
                },
              },
            },
          });
          const hostedPaymentPage = yield* nexi.createHostedPaymentPage({
            orderId: order.id,
            amount: nexiAmount.amount,
            currency: nexiAmount.currency,
            locale,
            notificationUrl: yield* getNotificationUrl,
            resultUrl: yield* getCheckoutStatusUrl(locale, order.id, "success"),
            cancelUrl: yield* getCheckoutStatusUrl(
              locale,
              order.id,
              "cancelled"
            ),
          }).pipe(
            Effect.tapError(() =>
              paymentOrders.deleteUnassociatedCreated(order.id).pipe(
                Effect.catchAll((cleanupError) =>
                  Effect.logError(
                    "Failed to delete unassociated payment order after Nexi checkout failure",
                    {
                      orderId: order.id,
                      cleanupError,
                    }
                  )
                )
              )
            )
          );

          yield* paymentOrders.attachNexiSession({
            id: order.id,
            securityToken: hostedPaymentPage.securityToken,
            providerOperationId: hostedPaymentPage.orderId,
            providerStatus: "hpp_created",
          });
          yield* paymentOrders.markPaymentPending(order.id);

          yield* Effect.logInfo("Workspace checkout payment pending", {
            locale,
            entryTier: data.entryTier,
            orderId: order.id,
          });

          return { redirectUrl: hostedPaymentPage.hostedPage };
        },
        (effect, data, locale) =>
          effect.pipe(
            Effect.scoped,
            Effect.annotateLogs({
              locale,
              data,
            }),
            Effect.mapError(mapCheckoutFailure)
          )
      ),
    });
  })
);

export const CheckoutServiceLiveWithDependencies = CheckoutServiceLive.pipe(
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
