import { Effect, Layer, Schema } from "effect";
import { NextResponse } from "next/server";
import { CustomerAccountResolver } from "@/features/account";
import { GoodsOrderService } from "@/features/goods/backend";
import { resolveGoodsCustomerId } from "@/features/goods/backend/goods-route";
import { orderIdSchema } from "@/features/order";
import {
  defineWorkspaceRoute,
  WorkspaceRouteFailure,
} from "@/shared/backend/workspace-route";

type GoodsOrderRouteLayer = Layer.Layer<
  CustomerAccountResolver | GoodsOrderService,
  unknown,
  never
>;

type GoodsOrderRouteContext = {
  readonly params: Promise<{ readonly orderId: string }>;
};

export const makeGoodsOrderRoute = (layer: GoodsOrderRouteLayer) =>
  defineWorkspaceRoute(
    {
      operation: "goods.orders.get",
      cancellation: "interrupt-on-disconnect",
    },
    (_request: Request, context: GoodsOrderRouteContext) =>
      Effect.gen(function* () {
        const { orderId: rawOrderId } = yield* Effect.promise(
          () => context.params
        );
        const orderId = yield* Schema.decodeUnknownEffect(orderIdSchema)(
          rawOrderId
        ).pipe(
          Effect.mapError(
            (cause) =>
              new WorkspaceRouteFailure({
                statusCode: 404,
                publicMessage: "Goods order was not found.",
                cause,
              })
          )
        );
        const customerId = yield* resolveGoodsCustomerId();
        const orders = yield* GoodsOrderService;
        const result = yield* orders.get(customerId, orderId);
        return NextResponse.json(result, {
          headers: { "Cache-Control": "private, no-store" },
        });
      }).pipe(
        Effect.catchTag("GoodsOrderNotFoundError", (cause) =>
          Effect.fail(
            new WorkspaceRouteFailure({
              statusCode: 404,
              publicMessage: "Goods order was not found.",
              cause,
            })
          )
        ),
        Effect.provide(layer),
        Effect.mapError((cause) =>
          cause instanceof WorkspaceRouteFailure
            ? cause
            : WorkspaceRouteFailure.internal(
                "Goods order is temporarily unavailable."
              )(cause)
        )
      )
  );

const goodsOrderRouteLayer = Layer.merge(
  CustomerAccountResolver.Live,
  GoodsOrderService.Live
);

export const GET = makeGoodsOrderRoute(goodsOrderRouteLayer);
