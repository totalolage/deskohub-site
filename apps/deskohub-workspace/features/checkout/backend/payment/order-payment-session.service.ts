import { randomUUID } from "node:crypto";
import type { DotyposCustomerId } from "@deskohub/dotypos";
import {
  type ExternalAPIError,
  type HostedPaymentCustomer,
  type NetworkError,
  type NexiOrderId,
  NexiOrderIdSchema,
  NexiService,
} from "@deskohub/nexi";
import { Context, Data, Effect, Layer, Match, Schema } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import type { AccountingDocumentSnapshot } from "@/features/accounting/accounting-document-snapshot";
import {
  type WorkspaceMoney,
  withWorkspaceMoneyCurrency,
} from "@/features/checkout/workspace-money";
import type { Locale } from "@/features/i18n";
import type { OrderId } from "@/features/order";
import { dotyposCustomerIdSchema } from "@/features/reservation/dotypos-customer";
import { PostHogEventService } from "@/shared/backend/analytics/posthog-event.service";
import { WorkspaceNexiLayer } from "@/shared/backend/config/nexi.config";
import {
  capturePaymentCompleted,
  capturePaymentFailed,
  capturePaymentStarted,
} from "../analytics/posthog-lifecycle-events";
import {
  isNexiPaymentAttempt,
  type PaymentAttempt,
} from "../repositories/payment-attempt.repository";
import {
  PaymentLifecycleRepository,
  type PaymentLifecycleRepositoryError,
  type PaymentSessionEvidence,
} from "../repositories/payment-lifecycle.repository";
import { NexiAmountFromWorkspaceMoney } from "./nexi-amount.codec";
import { getNexiCurrencyOverride } from "./nexi-currency";

export class OrderPaymentSessionError extends Data.TaggedError(
  "OrderPaymentSessionError"
)<{ readonly message: string; readonly cause?: unknown }> {}

export type OrderPaymentSessionResult =
  | {
      readonly status: "paid";
      readonly attempt: PaymentAttempt;
      readonly changed: boolean;
    }
  | {
      readonly status: "redirect";
      readonly redirectUrl: string;
      readonly attempt: PaymentAttempt;
    }
  | { readonly status: "in_progress" }
  | { readonly status: "outstanding_order"; readonly orderId: OrderId };

export interface IOrderPaymentSessionService {
  readonly startOrResume: (input: {
    readonly orderId: OrderId;
    readonly locale: Locale;
    readonly amount: WorkspaceMoney;
    readonly accountingSnapshot: AccountingDocumentSnapshot;
    readonly payer: HostedPaymentCustomer;
    readonly callbacks: {
      readonly notificationUrl: string;
      readonly resultUrl: string;
      readonly cancelUrl: string;
    };
    readonly evidence: PaymentSessionEvidence;
  }) => Effect.Effect<
    OrderPaymentSessionResult,
    | OrderPaymentSessionError
    | PaymentLifecycleRepositoryError
    | ExternalAPIError
    | NetworkError
  >;
}

export class OrderPaymentSessionService extends Context.Service<
  OrderPaymentSessionService,
  IOrderPaymentSessionService
>()("@deskohub-workspace/checkout/OrderPaymentSessionService") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const nexi = yield* NexiService;
      const paymentLifecycle = yield* PaymentLifecycleRepository;
      const posthogEvents = yield* PostHogEventService;

      const markDefinitiveCreationFailure = Effect.fn(
        "OrderPaymentSession.markDefinitiveCreationFailure"
      )(function* (input: {
        readonly cause: ExternalAPIError | NetworkError;
        readonly orderId: OrderId;
        readonly attempt: PaymentAttempt;
      }) {
        if (!isDefinitiveHostedPaymentPageFailure(input.cause)) {
          yield* Effect.logError(
            "Ambiguous hosted payment page creation failure retained the active attempt",
            {
              orderId: input.orderId,
              paymentAttemptId: input.attempt.id,
              errorTag: input.cause._tag,
            }
          );
          return;
        }
        const transition = yield* paymentLifecycle.markTerminal({
          id: input.attempt.id,
          orderId: input.orderId,
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
          }).pipe(Effect.provideService(PostHogEventService, posthogEvents));
        }
      });

      return OrderPaymentSessionService.of({
        startOrResume: Effect.fn("OrderPaymentSession.startOrResume")(
          function* (input) {
            const payerCustomerId = yield* getPayerCustomerId(input.payer);
            const providerOrderId =
              input.amount.value > 0 ? generateNexiOrderId() : undefined;
            const admission = yield* paymentLifecycle.admitPaymentSession({
              orderId: input.orderId,
              providerOrderId,
              payerCustomerId,
              amount: input.amount,
              evidence: input.evidence,
              locale: input.locale,
              accountingSnapshot: input.accountingSnapshot,
            });

            return yield* Match.value(admission).pipe(
              Match.discriminatorsExhaustive("status")({
                paid: ({ attempt, changed }) =>
                  Effect.gen(function* () {
                    if (changed) {
                      yield* capturePaymentCompleted({
                        attempt,
                        timestamp: attempt.updatedAt,
                      }).pipe(
                        Effect.provideService(
                          PostHogEventService,
                          posthogEvents
                        )
                      );
                    }
                    return { status: "paid" as const, attempt, changed };
                  }),
                resume: ({ attempt }) =>
                  Effect.succeed({
                    status: "redirect" as const,
                    redirectUrl: attempt.providerRedirectUrl!,
                    attempt,
                  }),
                in_progress: () =>
                  Effect.succeed({ status: "in_progress" as const }),
                outstanding_order: ({ orderId }) =>
                  Effect.succeed({
                    status: "outstanding_order" as const,
                    orderId,
                  }),
                created: ({ attempt, correlationId }) =>
                  Effect.gen(function* () {
                    if (!isNexiPaymentAttempt(attempt)) {
                      return yield* new OrderPaymentSessionError({
                        message:
                          "Nexi payment attempt configuration is invalid.",
                      });
                    }
                    const nexiAmount = yield* Schema.encodeEffect(
                      NexiAmountFromWorkspaceMoney
                    )(
                      withWorkspaceMoneyCurrency(
                        input.amount,
                        getNexiCurrencyOverride()
                      )
                    ).pipe(
                      Effect.mapError(
                        (cause) =>
                          new OrderPaymentSessionError({
                            message: "Unsupported payment amount.",
                            cause,
                          })
                      )
                    );
                    const hostedPaymentPage = yield* nexi
                      .createHostedPaymentPage({
                        orderId: attempt.providerOrderId,
                        correlationId,
                        amount: nexiAmount.amount,
                        currency: nexiAmount.currency,
                        locale: input.locale,
                        notificationUrl: input.callbacks.notificationUrl,
                        resultUrl: input.callbacks.resultUrl,
                        cancelUrl: input.callbacks.cancelUrl,
                        customer: input.payer,
                      })
                      .pipe(
                        Effect.tapError((cause) =>
                          markDefinitiveCreationFailure({
                            cause,
                            orderId: input.orderId,
                            attempt,
                          })
                        )
                      );
                    const attached =
                      yield* paymentLifecycle.attachProviderSession({
                        id: attempt.id,
                        securityToken: hostedPaymentPage.securityToken,
                        providerRedirectUrl: hostedPaymentPage.hostedPage,
                      });
                    yield* capturePaymentStarted({
                      attempt: attached,
                      timestamp: attached.updatedAt,
                    }).pipe(
                      Effect.provideService(PostHogEventService, posthogEvents)
                    );
                    return {
                      status: "redirect" as const,
                      redirectUrl: hostedPaymentPage.hostedPage,
                      attempt: attached,
                    };
                  }),
              })
            );
          }
        ),
      });
    })
  );

  static Live = this.Default.pipe(
    Layer.provide(PaymentLifecycleRepository.Default),
    Layer.provide(PostHogEventService.Live),
    Layer.provide(WorkspaceDatabase.Default),
    Layer.provide(WorkspaceNexiLayer)
  );
}

const getPayerCustomerId = Effect.fn("OrderPaymentSession.getPayerCustomerId")(
  function* (payer: HostedPaymentCustomer) {
    if (!payer.id) {
      return yield* new OrderPaymentSessionError({
        message: "A server-derived payer identity is required.",
      });
    }
    return yield* Schema.decodeUnknownEffect(dotyposCustomerIdSchema)(
      payer.id
    ).pipe(
      Effect.mapError(
        (cause) =>
          new OrderPaymentSessionError({
            message: "The payer identity is invalid.",
            cause,
          })
      )
    ) as Effect.Effect<DotyposCustomerId, OrderPaymentSessionError>;
  }
);

const generateNexiOrderId = (): NexiOrderId =>
  NexiOrderIdSchema.make(
    `D${BigInt(`0x${randomUUID().replaceAll("-", "")}`)
      .toString(36)
      .toUpperCase()}`
  );

const isDefinitiveHostedPaymentPageFailure = (
  cause: ExternalAPIError | NetworkError
) =>
  cause._tag === "ExternalAPIError" &&
  cause.statusCode !== undefined &&
  cause.statusCode >= 400 &&
  cause.statusCode < 500 &&
  ![408, 409, 425, 429].includes(cause.statusCode);
