import "server-only";

import { randomUUID } from "node:crypto";
import {
  type DotyposCustomer,
  type DotyposCustomerId,
  DotyposService,
} from "@deskohub/dotypos";
import {
  classifyNexiFailureStatus,
  getNexiPaymentMetadata,
  type HostedPaymentCustomer,
  NexiCurrencySchema,
  NexiCustomerReferenceSchema,
  type ExternalAPIError as NexiExternalApiError,
  type NetworkError as NexiNetworkError,
  type NexiOrderId,
  NexiOrderIdSchema,
  NexiService,
} from "@deskohub/nexi";
import { Context, Data, Effect, Layer, Schema } from "effect";
import { appendVercelPreviewProtectionBypass } from "@/features/checkout/backend/checkout/vercel-preview-protection-bypass";
import { NexiAmountFromWorkspaceMoney } from "@/features/checkout/backend/payment/nexi-amount.codec";
import { getNexiCurrencyOverride } from "@/features/checkout/backend/payment/nexi-currency";
import { withWorkspaceMoneyCurrency } from "@/features/checkout/workspace-money";
import { PostHogEventService } from "@/shared/backend/analytics/posthog-event.service";
import {
  getWorkspaceRuntimeCallbackOrigin,
  type WorkspaceUrlConfigError,
} from "@/shared/backend/config/workspace-url.config";
import type {
  MobileShopPaymentSession,
  MobileShopPurchaseId,
} from "../contracts";
import {
  captureMobileShopPaymentCompleted,
  captureMobileShopPaymentStarted,
  captureMobileShopPaymentTerminal,
} from "./posthog-lifecycle-events";
import {
  type IMobileShopPurchaseLifecycleRepository,
  MobileShopPurchaseLifecycleRepository,
} from "./purchase-lifecycle.repository";

export class MobileShopPaymentError extends Data.TaggedError(
  "MobileShopPaymentError"
)<{
  readonly reason:
    | "already_paid"
    | "in_progress"
    | "customer_unavailable"
    | "provider_unavailable"
    | "state_unavailable";
  readonly cause?: unknown;
}> {}

export interface IMobileShopPaymentService {
  readonly resumePayment: (input: {
    readonly purchaseId: MobileShopPurchaseId;
    readonly customerId: DotyposCustomerId;
  }) => Effect.Effect<MobileShopPaymentSession | null, MobileShopPaymentError>;
  readonly startPayment: (input: {
    readonly purchaseId: MobileShopPurchaseId;
    readonly customerId: DotyposCustomerId;
  }) => Effect.Effect<MobileShopPaymentSession, MobileShopPaymentError>;
  readonly reconcilePayment: (input: {
    readonly purchaseId: MobileShopPurchaseId;
    readonly customerId: DotyposCustomerId;
  }) => Effect.Effect<void, MobileShopPaymentError>;
}

export class MobileShopPaymentService extends Context.Service<
  MobileShopPaymentService,
  IMobileShopPaymentService
>()("@deskohub-workspace/mobile-shop/MobileShopPaymentService") {
  static Live = Layer.effect(
    this,
    Effect.gen(function* () {
      const purchases = yield* MobileShopPurchaseLifecycleRepository;
      const dotypos = yield* DotyposService;
      const nexi = yield* NexiService;
      const posthog = yield* PostHogEventService;

      const resumePayment = Effect.fn("MobileShopPaymentService.resumePayment")(
        function* (input: {
          readonly purchaseId: MobileShopPurchaseId;
          readonly customerId: DotyposCustomerId;
        }) {
          const payment = yield* purchases
            .findPaymentForOwner(input)
            .pipe(Effect.mapError(mapStateError));
          const hostedPageUrl = payment?.attempt.providerRedirectUrl;
          return payment?.order.paymentState === "pending" &&
            payment.attempt.state === "pending" &&
            payment.attempt.securityToken &&
            hostedPageUrl
            ? { orderId: input.purchaseId, hostedPageUrl }
            : null;
        }
      );

      const reconcilePayment = Effect.fn(
        "MobileShopPaymentService.reconcilePayment"
      )(
        function* (input: {
          readonly purchaseId: MobileShopPurchaseId;
          readonly customerId: DotyposCustomerId;
        }) {
          const payment = yield* purchases
            .findPaymentForOwner(input)
            .pipe(Effect.mapError(mapStateError));
          if (!payment || payment.order.paymentState !== "pending") return;
          if (
            !payment.attempt.providerOrderId ||
            !payment.attempt.securityToken
          ) {
            return;
          }

          const currency = yield* Schema.decodeUnknownEffect(
            NexiCurrencySchema
          )(payment.attempt.currency).pipe(Effect.mapError(mapProviderError));
          const verification = yield* nexi
            .verifyPaymentOutcome({
              orderId: payment.attempt.providerOrderId,
              correlationId: payment.order.correlationId,
              amount: String(payment.attempt.amountValue),
              currency: getNexiCurrencyOverride() ?? currency,
              securityToken: payment.attempt.securityToken,
            })
            .pipe(Effect.mapError(mapProviderError));
          if (verification.mismatches.length > 0) {
            yield* Effect.logError(
              "Mobile shop payment reconciliation found provider mismatches",
              {
                purchaseId: input.purchaseId,
                mismatches: verification.mismatches,
              }
            );
            return;
          }

          const metadata = getNexiPaymentMetadata(verification);
          if (verification.status === "success") {
            const transition = yield* purchases
              .markPaid({
                paymentAttemptId: payment.attempt.id,
                providerOperationId: metadata.providerOperationId,
                providerStatus: metadata.providerStatus,
                paidAt: Temporal.Now.instant(),
              })
              .pipe(Effect.mapError(mapStateError));
            if (transition.changed) {
              yield* captureMobileShopPaymentCompleted(transition).pipe(
                Effect.provideService(PostHogEventService, posthog)
              );
            }
            if (transition.additionalPayment) {
              yield* Effect.logFatal(
                "A second mobile shop payment attempt was reconciled paid",
                {
                  purchaseId: transition.payment.order.id,
                  paymentAttemptId: transition.payment.attempt.id,
                }
              );
            }
            return;
          }
          if (verification.status !== "failure") return;

          const transition = yield* purchases
            .markTerminal({
              paymentAttemptId: payment.attempt.id,
              providerOperationId: metadata.providerOperationId,
              providerStatus: metadata.providerStatus,
              state: classifyNexiFailureStatus(metadata.providerStatus),
              failureCode: "nexi_payment_failed",
            })
            .pipe(Effect.mapError(mapStateError));
          if (transition.changed) {
            yield* captureMobileShopPaymentTerminal(transition).pipe(
              Effect.provideService(PostHogEventService, posthog)
            );
          }
        },
        (effect, input) =>
          effect.pipe(
            Effect.annotateLogs({ purchaseId: input.purchaseId }),
            Effect.scoped
          )
      );

      return {
        resumePayment,
        startPayment: Effect.fn("MobileShopPaymentService.startPayment")(
          function* (input) {
            const prepared = yield* purchases
              .preparePayment({
                ...input,
                providerOrderId: generateNexiOrderId(),
              })
              .pipe(Effect.mapError(mapStateError));
            if (prepared.kind === "paid") {
              return yield* new MobileShopPaymentError({
                reason: "already_paid",
              });
            }
            if (prepared.kind === "in_progress") {
              return yield* new MobileShopPaymentError({
                reason: "in_progress",
              });
            }
            if (prepared.kind === "existing") {
              const hostedPageUrl =
                prepared.payment.attempt.providerRedirectUrl;
              if (!hostedPageUrl) {
                return yield* new MobileShopPaymentError({
                  reason: "in_progress",
                });
              }
              return {
                orderId: input.purchaseId,
                hostedPageUrl,
              };
            }

            const customer = yield* dotypos.getCustomer(input.customerId).pipe(
              Effect.tapError(() =>
                markPreProviderCreationFailed({
                  paymentAttemptId: prepared.payment.attempt.id,
                  failureCode: "customer_unavailable",
                  purchases,
                })
              ),
              Effect.mapError(
                (cause) =>
                  new MobileShopPaymentError({
                    reason: "customer_unavailable",
                    cause,
                  })
              )
            );
            const nexiAmount = yield* Schema.encodeEffect(
              NexiAmountFromWorkspaceMoney
            )(
              withWorkspaceMoneyCurrency(
                {
                  value: prepared.payment.attempt.amountValue,
                  exponent: prepared.payment.attempt.amountExponent,
                  currency: prepared.payment.attempt.currency,
                },
                getNexiCurrencyOverride()
              )
            ).pipe(
              Effect.tapError(() =>
                markPreProviderCreationFailed({
                  paymentAttemptId: prepared.payment.attempt.id,
                  failureCode: "payment_amount_invalid",
                  purchases,
                })
              ),
              Effect.mapError(mapProviderError)
            );
            const urls = yield* getMobileShopPaymentUrls({
              purchaseId: input.purchaseId,
              locale: prepared.payment.order.locale,
            }).pipe(
              Effect.tapError(() =>
                markPreProviderCreationFailed({
                  paymentAttemptId: prepared.payment.attempt.id,
                  failureCode: "payment_callback_unavailable",
                  purchases,
                })
              )
            );
            const providerOrderId = prepared.payment.attempt.providerOrderId;
            if (!providerOrderId) {
              yield* markPreProviderCreationFailed({
                paymentAttemptId: prepared.payment.attempt.id,
                failureCode: "provider_order_id_unavailable",
                purchases,
              });
              return yield* new MobileShopPaymentError({
                reason: "state_unavailable",
              });
            }

            const hostedPage = yield* nexi
              .createHostedPaymentPage({
                orderId: providerOrderId,
                correlationId: prepared.payment.order.correlationId,
                amount: nexiAmount.amount,
                currency: nexiAmount.currency,
                locale: prepared.payment.order.locale,
                notificationUrl: urls.notificationUrl,
                resultUrl: urls.resultUrl,
                cancelUrl: urls.cancelUrl,
                customer: toHostedPaymentCustomer(input.customerId, customer),
              })
              .pipe(
                Effect.tapError((cause) =>
                  markDefinitiveCreationFailure({
                    cause,
                    paymentAttemptId: prepared.payment.attempt.id,
                    purchases,
                  })
                ),
                Effect.mapError(mapProviderError)
              );
            const attached = yield* purchases
              .attachProviderSession({
                paymentAttemptId: prepared.payment.attempt.id,
                securityToken: hostedPage.securityToken,
                providerRedirectUrl: hostedPage.hostedPage,
              })
              .pipe(Effect.mapError(mapStateError));
            yield* captureMobileShopPaymentStarted(attached).pipe(
              Effect.provideService(PostHogEventService, posthog)
            );

            return {
              orderId: input.purchaseId,
              hostedPageUrl: hostedPage.hostedPage,
            };
          },
          (effect, input) =>
            effect.pipe(
              Effect.annotateLogs({ purchaseId: input.purchaseId }),
              Effect.scoped
            )
        ),
        reconcilePayment,
      } satisfies IMobileShopPaymentService;
    })
  );

  static Unavailable = Layer.succeed(this, {
    resumePayment: () =>
      Effect.fail(
        new MobileShopPaymentError({ reason: "provider_unavailable" })
      ),
    startPayment: () =>
      Effect.fail(
        new MobileShopPaymentError({ reason: "provider_unavailable" })
      ),
    reconcilePayment: () =>
      Effect.fail(
        new MobileShopPaymentError({ reason: "provider_unavailable" })
      ),
  });
}

const generateNexiOrderId = (): NexiOrderId =>
  NexiOrderIdSchema.make(
    `D${BigInt(`0x${randomUUID().replaceAll("-", "")}`)
      .toString(36)
      .toUpperCase()}`
  );

const getMobileShopPaymentUrls = (input: {
  readonly purchaseId: MobileShopPurchaseId;
  readonly locale: "cs-CZ" | "en-US";
}): Effect.Effect<
  {
    readonly notificationUrl: string;
    readonly resultUrl: string;
    readonly cancelUrl: string;
  },
  MobileShopPaymentError
> =>
  getWorkspaceRuntimeCallbackOrigin.pipe(
    Effect.flatMap((callbackOrigin) =>
      Effect.try({
        try: () => {
          const notificationUrl = new URL(
            "/api/webhooks/nexi/mobile-shop",
            callbackOrigin
          );
          appendVercelPreviewProtectionBypass(notificationUrl);
          const resultUrl = new URL(
            `/api/v1/mobile/payment-return/${encodeURIComponent(input.purchaseId)}`,
            callbackOrigin
          );
          resultUrl.searchParams.set("locale", input.locale);
          appendVercelPreviewProtectionBypass(resultUrl);
          const cancelUrl = new URL(resultUrl);
          cancelUrl.searchParams.set("outcome", "cancelled");
          return {
            notificationUrl: notificationUrl.toString(),
            resultUrl: resultUrl.toString(),
            cancelUrl: cancelUrl.toString(),
          };
        },
        catch: (cause) =>
          new MobileShopPaymentError({
            reason: "provider_unavailable",
            cause,
          }),
      })
    ),
    Effect.mapError(
      (cause: WorkspaceUrlConfigError | MobileShopPaymentError) =>
        cause._tag === "MobileShopPaymentError"
          ? cause
          : new MobileShopPaymentError({
              reason: "provider_unavailable",
              cause,
            })
    )
  );

const toHostedPaymentCustomer = (
  customerId: DotyposCustomerId,
  customer: DotyposCustomer
): HostedPaymentCustomer => ({
  id: NexiCustomerReferenceSchema.make(customerId),
  name:
    [customer.firstName, customer.lastName]
      .map((part) => part?.trim())
      .filter(Boolean)
      .join(" ") ||
    customer.companyName?.trim() ||
    "Deskohub customer",
  ...(customer.email?.trim() && { email: customer.email.trim() }),
});

const isDefinitiveHostedPaymentPageFailure = (
  cause: NexiExternalApiError | NexiNetworkError
) =>
  cause._tag === "ExternalAPIError" &&
  cause.statusCode !== undefined &&
  cause.statusCode >= 400 &&
  cause.statusCode < 500 &&
  ![408, 409, 425, 429].includes(cause.statusCode);

const markDefinitiveCreationFailure = (input: {
  readonly cause: NexiExternalApiError | NexiNetworkError;
  readonly paymentAttemptId: Parameters<
    IMobileShopPurchaseLifecycleRepository["markProviderCreationFailed"]
  >[0]["paymentAttemptId"];
  readonly purchases: IMobileShopPurchaseLifecycleRepository;
}) =>
  isDefinitiveHostedPaymentPageFailure(input.cause)
    ? input.purchases
        .markProviderCreationFailed({
          paymentAttemptId: input.paymentAttemptId,
          failureCode: "nexi_hpp_create_failed",
        })
        .pipe(
          Effect.tapError((cause) =>
            Effect.logFatal(
              "Mobile shop definitive payment failure marker failed",
              { paymentAttemptId: input.paymentAttemptId, cause }
            )
          ),
          Effect.ignore
        )
    : Effect.logError(
        "Ambiguous mobile shop hosted payment creation failure retained the active attempt",
        { paymentAttemptId: input.paymentAttemptId }
      );

const markPreProviderCreationFailed = (input: {
  readonly paymentAttemptId: Parameters<
    IMobileShopPurchaseLifecycleRepository["markProviderCreationFailed"]
  >[0]["paymentAttemptId"];
  readonly failureCode: string;
  readonly purchases: IMobileShopPurchaseLifecycleRepository;
}) =>
  input.purchases
    .markProviderCreationFailed({
      paymentAttemptId: input.paymentAttemptId,
      failureCode: input.failureCode,
    })
    .pipe(
      Effect.tapError((cause) =>
        Effect.logFatal(
          "Mobile shop pre-provider payment failure marker failed",
          { paymentAttemptId: input.paymentAttemptId, cause }
        )
      ),
      Effect.ignore
    );

const mapStateError = (cause: unknown) =>
  new MobileShopPaymentError({ reason: "state_unavailable", cause });

const mapProviderError = (cause: unknown) =>
  new MobileShopPaymentError({ reason: "provider_unavailable", cause });
