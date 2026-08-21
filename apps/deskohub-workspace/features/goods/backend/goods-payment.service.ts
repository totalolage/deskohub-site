import {
  type DotyposCustomer,
  type DotyposCustomerId,
  DotyposService,
} from "@deskohub/dotypos";
import { Context, Data, Effect, Layer, Match } from "effect";
import {
  type GoodsBillingIntent,
  makeGoodsAccountingDocumentSnapshot,
} from "@/features/accounting/accounting-document-snapshot";
import { appendVercelPreviewProtectionBypass } from "@/features/checkout/backend/checkout/vercel-preview-protection-bypass";
import { PaidOrderCompletionService } from "@/features/checkout/backend/fulfillment/paid-order-completion.service";
import {
  OrderPaymentSessionError,
  OrderPaymentSessionService,
} from "@/features/checkout/backend/payment";
import { getNexiHostedPaymentCustomer } from "@/features/checkout/backend/payment/nexi-customer-info";
import { PaymentLifecycleStateError } from "@/features/checkout/backend/repositories/payment-lifecycle.repository";
import type { Locale } from "@/features/i18n";
import type { OrderId } from "@/features/order";
import { WorkspaceDotyposLayer } from "@/shared/backend/config/dotypos.config";
import { getWorkspaceRuntimeCallbackOrigin } from "@/shared/backend/config/workspace-url.config";
import {
  GoodsOrderNotFoundError,
  GoodsOrderRepository,
  GoodsOrderStoredDataError,
} from "./goods-order.repository";

export class GoodsPaymentConflictError extends Data.TaggedError(
  "GoodsPaymentConflictError"
)<{ readonly cause: unknown }> {}

export class GoodsPaymentUnavailableError extends Data.TaggedError(
  "GoodsPaymentUnavailableError"
)<{ readonly cause: unknown }> {}

export type GoodsPaymentResult =
  | { readonly status: "paid" }
  | { readonly status: "redirect"; readonly redirectUrl: string }
  | { readonly status: "in_progress" }
  | { readonly status: "outstanding_order"; readonly orderId: OrderId }
  | { readonly status: "billing_details_required" };

interface IGoodsPaymentService {
  readonly startOrResume: (input: {
    readonly customerId: DotyposCustomerId;
    readonly orderId: OrderId;
    readonly locale: Locale;
    readonly billing: GoodsBillingIntent;
  }) => Effect.Effect<
    GoodsPaymentResult,
    | GoodsOrderNotFoundError
    | GoodsPaymentConflictError
    | GoodsPaymentUnavailableError
  >;
}

export class GoodsPaymentService extends Context.Service<
  GoodsPaymentService,
  IGoodsPaymentService
>()("@deskohub-workspace/goods/GoodsPaymentService") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const dotypos = yield* DotyposService;
      const completion = yield* PaidOrderCompletionService;
      const orders = yield* GoodsOrderRepository;
      const payments = yield* OrderPaymentSessionService;

      return GoodsPaymentService.of({
        startOrResume: Effect.fn("GoodsPaymentService.startOrResume")(
          function* (input) {
            const facts = yield* orders
              .getPaymentFacts(input.customerId, input.orderId)
              .pipe(Effect.mapError(mapOrderEvidenceError));
            const customer = yield* dotypos
              .getCustomer(input.customerId)
              .pipe(
                Effect.mapError(
                  (cause) => new GoodsPaymentUnavailableError({ cause })
                )
              );
            const accountingSnapshot =
              yield* makeGoodsAccountingDocumentSnapshot({
                ...facts,
                customer,
                locale: input.locale,
                billing: input.billing,
              }).pipe(
                Effect.catchTag(
                  "GoodsAccountingDocumentSnapshotInputError",
                  (cause) =>
                    cause.reason === "billing_details_required"
                      ? Effect.succeed(undefined)
                      : Effect.fail(new GoodsPaymentConflictError({ cause }))
                )
              );
            const payer = yield* makeGoodsPayer(customer);
            if (!accountingSnapshot || !payer) {
              return { status: "billing_details_required" } as const;
            }
            const callbacks = yield* makeGoodsPaymentCallbacks(input.orderId);
            const result = yield* payments
              .startOrResume({
                orderId: input.orderId,
                locale: input.locale,
                amount: facts.displayedQuote.discountedSubtotal,
                accountingSnapshot,
                payer,
                callbacks,
                evidence: { mode: "order_evidence_committed" },
              })
              .pipe(Effect.mapError(mapPaymentSessionError));

            return yield* Match.value(result).pipe(
              Match.discriminatorsExhaustive("status")({
                paid: ({ attempt }) =>
                  completion
                    .complete({
                      kind: "goods",
                      orderId: input.orderId,
                      paymentAttemptId: attempt.id,
                    })
                    .pipe(
                      Effect.mapError(
                        (cause) => new GoodsPaymentUnavailableError({ cause })
                      ),
                      Effect.as({ status: "paid" as const })
                    ),
                redirect: ({ redirectUrl }) =>
                  Effect.succeed({
                    status: "redirect" as const,
                    redirectUrl,
                  }),
                in_progress: () =>
                  Effect.succeed({ status: "in_progress" as const }),
                outstanding_order: ({ orderId }) =>
                  Effect.succeed({
                    status: "outstanding_order" as const,
                    orderId,
                  }),
              })
            );
          }
        ),
      });
    })
  );

  static Live = this.Default.pipe(
    Layer.provide(
      Layer.mergeAll(
        WorkspaceDotyposLayer,
        GoodsOrderRepository.Live,
        OrderPaymentSessionService.Live,
        PaidOrderCompletionService.Live
      )
    )
  );
}

const makeGoodsPayer = Effect.fn("GoodsPaymentService.makePayer")(function* (
  customer: DotyposCustomer
) {
  const id = customer.id;
  const name =
    [customer.firstName, customer.lastName]
      .map((part) => part?.trim())
      .filter((part): part is string => Boolean(part))
      .join(" ") || customer.companyName?.trim();
  const email = customer.email?.trim();
  const phone = customer.phone?.trim();
  if (!(id && name && email)) return undefined;

  try {
    return getNexiHostedPaymentCustomer({ id, name, email, phone });
  } catch {
    return getNexiHostedPaymentCustomer({ id, name, email });
  }
});

const makeGoodsPaymentCallbacks = Effect.fn(
  "GoodsPaymentService.makeCallbacks"
)(function* (orderId: OrderId) {
  const origin = yield* getWorkspaceRuntimeCallbackOrigin.pipe(
    Effect.mapError((cause) => new GoodsPaymentUnavailableError({ cause }))
  );
  return yield* Effect.try({
    try: () => {
      const notificationUrl = new URL("/api/webhooks/nexi", origin);
      const resultUrl = new URL(
        `/api/v1/goods/orders/${encodeURIComponent(orderId)}`,
        origin
      );
      const cancelUrl = new URL(resultUrl);
      resultUrl.searchParams.set("paymentOutcome", "completed");
      cancelUrl.searchParams.set("paymentOutcome", "cancelled");
      for (const url of [notificationUrl, resultUrl, cancelUrl]) {
        appendVercelPreviewProtectionBypass(url);
      }
      return {
        notificationUrl: notificationUrl.toString(),
        resultUrl: resultUrl.toString(),
        cancelUrl: cancelUrl.toString(),
      };
    },
    catch: (cause) => new GoodsPaymentUnavailableError({ cause }),
  });
});

const mapOrderEvidenceError = (cause: unknown) => {
  if (cause instanceof GoodsOrderNotFoundError) return cause;
  return cause instanceof GoodsOrderStoredDataError
    ? new GoodsPaymentConflictError({ cause })
    : new GoodsPaymentUnavailableError({ cause });
};

const mapPaymentSessionError = (cause: unknown) =>
  cause instanceof PaymentLifecycleStateError ||
  cause instanceof OrderPaymentSessionError
    ? new GoodsPaymentConflictError({ cause })
    : new GoodsPaymentUnavailableError({ cause });
