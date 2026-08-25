import { Effect, Layer } from "effect";
import { NextResponse } from "next/server";
import { CustomerAccountResolver } from "@/features/account";
import { GoodsOrderService } from "@/features/goods/backend";
import { resolveGoodsCustomerId } from "@/features/goods/backend/goods-route";
import {
  defineWorkspaceRoute,
  WorkspaceRouteFailure,
} from "@/shared/backend/workspace-route";

type GoodsOrdersRouteLayer = Layer.Layer<
  CustomerAccountResolver | GoodsOrderService,
  unknown,
  never
>;

export const makeGoodsOrdersRoute = (layer: GoodsOrdersRouteLayer) =>
  defineWorkspaceRoute(
    {
      operation: "goods.orders.list",
      cancellation: "interrupt-on-disconnect",
    },
    () =>
      Effect.gen(function* () {
        const customerId = yield* resolveGoodsCustomerId();
        const orders = yield* GoodsOrderService;
        const result = yield* orders.list(customerId);
        return NextResponse.json(result, {
          headers: { "Cache-Control": "private, no-store" },
        });
      }).pipe(
        Effect.provide(layer),
        Effect.mapError((cause) =>
          cause instanceof WorkspaceRouteFailure
            ? cause
            : WorkspaceRouteFailure.internal(
                "Goods orders are temporarily unavailable."
              )(cause)
        )
      )
  );

const goodsOrdersRouteLayer = Layer.merge(
  CustomerAccountResolver.Live,
  GoodsOrderService.Live
);

export const GET = makeGoodsOrdersRoute(goodsOrdersRouteLayer);
