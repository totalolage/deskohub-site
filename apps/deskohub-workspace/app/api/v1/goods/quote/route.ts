import { Effect, Layer } from "effect";
import { NextResponse } from "next/server";
import { CustomerAccountResolver } from "@/features/account";
import {
  GoodsQuoteService,
  type GoodsQuoteUnavailableError,
} from "@/features/goods/backend";
import {
  decodeGoodsRequest,
  resolveGoodsCustomerId,
} from "@/features/goods/backend/goods-route";
import { goodsQuoteRequestSchema } from "@/features/goods/goods-quote";
import {
  defineWorkspaceRoute,
  WorkspaceRouteFailure,
} from "@/shared/backend/workspace-route";

type GoodsQuoteRouteLayer = Layer.Layer<
  CustomerAccountResolver | GoodsQuoteService,
  unknown,
  never
>;

export const makeGoodsQuoteRoute = (layer: GoodsQuoteRouteLayer) =>
  defineWorkspaceRoute(
    {
      operation: "goods.quote",
      cancellation: "interrupt-on-disconnect",
    },
    (request) =>
      Effect.gen(function* () {
        const input = yield* decodeGoodsRequest(
          request,
          goodsQuoteRequestSchema,
          "Quote request is invalid."
        );
        const customerId = yield* resolveGoodsCustomerId();
        const quotes = yield* GoodsQuoteService;
        const response = yield* quotes.quote(customerId, input);
        return NextResponse.json(response, {
          headers: { "Cache-Control": "private, no-store" },
        });
      }).pipe(
        Effect.catchTag("GoodsQuoteUnavailableError", quoteUnavailableResponse),
        Effect.provide(layer),
        Effect.mapError((cause) =>
          cause instanceof WorkspaceRouteFailure
            ? cause
            : WorkspaceRouteFailure.internal(
                "Goods quote is temporarily unavailable."
              )(cause)
        )
      )
  );

const quoteUnavailableResponse = (error: GoodsQuoteUnavailableError) => {
  if (error.reason === "dependency_unavailable") return Effect.fail(error);

  return Effect.succeed(
    NextResponse.json(
      {
        error: error.reason,
        ...(error.productIds && { productIds: error.productIds }),
      },
      {
        status: error.reason === "empty_cart" ? 400 : 409,
        headers: { "Cache-Control": "private, no-store" },
      }
    )
  );
};

const goodsQuoteRouteLayer = Layer.merge(
  CustomerAccountResolver.Live,
  GoodsQuoteService.Live
);

export const POST = makeGoodsQuoteRoute(goodsQuoteRouteLayer);
