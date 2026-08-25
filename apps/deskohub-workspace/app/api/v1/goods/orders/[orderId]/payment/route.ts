import { Effect, Layer, Option, Schema } from "effect";
import { NextResponse } from "next/server";
import { CustomerAccountResolver } from "@/features/account";
import { goodsBillingIntentSchema } from "@/features/accounting/accounting-document-snapshot";
import {
  type GoodsPaymentResult,
  GoodsPaymentService,
} from "@/features/goods/backend";
import {
  decodeGoodsRequest,
  resolveGoodsCustomerId,
} from "@/features/goods/backend/goods-route";
import { locales } from "@/features/i18n";
import { orderIdSchema } from "@/features/order";
import {
  defineWorkspaceRoute,
  WorkspaceRouteFailure,
} from "@/shared/backend/workspace-route";

const goodsPaymentRequestSchema = Schema.Struct({
  locale: Schema.Literals(locales),
  billing: goodsBillingIntentSchema,
});

type GoodsPaymentResponse =
  | GoodsPaymentResult
  | { readonly status: "not_found" }
  | { readonly status: "conflict" }
  | { readonly status: "unavailable" };

type GoodsPaymentRouteLayer = Layer.Layer<
  CustomerAccountResolver | GoodsPaymentService,
  unknown,
  never
>;

type GoodsPaymentRouteContext = {
  readonly params: Promise<{ readonly orderId: string }>;
};

export const makeGoodsPaymentRoute = (layer: GoodsPaymentRouteLayer) =>
  defineWorkspaceRoute(
    {
      operation: "goods.orders.payment",
      cancellation: "continue-after-disconnect",
    },
    (request: Request, context: GoodsPaymentRouteContext) =>
      Effect.gen(function* () {
        const input = yield* decodeGoodsRequest(
          request,
          goodsPaymentRequestSchema,
          "Goods payment request is invalid."
        );
        const { orderId: rawOrderId } = yield* Effect.promise(
          () => context.params
        );
        const orderId = Option.getOrUndefined(
          Schema.decodeUnknownOption(orderIdSchema)(rawOrderId)
        );
        if (!orderId) return paymentResponse({ status: "not_found" }, 404);

        const customerId = yield* resolveGoodsCustomerId();
        const payments = yield* GoodsPaymentService;
        const result = yield* payments.startOrResume({
          customerId,
          orderId,
          locale: input.locale,
          billing: input.billing,
        });
        return paymentResponse(result);
      }).pipe(
        Effect.catchTags({
          GoodsOrderNotFoundError: () =>
            Effect.succeed(paymentResponse({ status: "not_found" }, 404)),
          GoodsPaymentConflictError: () =>
            Effect.succeed(paymentResponse({ status: "conflict" }, 409)),
          GoodsPaymentUnavailableError: () =>
            Effect.succeed(paymentResponse({ status: "unavailable" }, 503)),
        }),
        Effect.provide(layer),
        Effect.mapError((cause) =>
          cause instanceof WorkspaceRouteFailure
            ? cause
            : WorkspaceRouteFailure.internal(
                "Goods payment is temporarily unavailable."
              )(cause)
        )
      )
  );

const paymentResponse = (body: GoodsPaymentResponse, status = 200) =>
  NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });

const goodsPaymentRouteLayer = Layer.merge(
  CustomerAccountResolver.Live,
  GoodsPaymentService.Live
);

export const POST = makeGoodsPaymentRoute(goodsPaymentRouteLayer);
