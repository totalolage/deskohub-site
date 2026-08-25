import { Effect, Layer } from "effect";
import { NextResponse } from "next/server";
import { CustomerAccountResolver } from "@/features/account";
import {
  removeGoodsCartItemInputSchema,
  setGoodsCartItemInputSchema,
} from "@/features/goods";
import type {
  GoodsCartRevisionConflict,
  GoodsCartUnavailableError,
} from "@/features/goods/backend";
import { GoodsCartService } from "@/features/goods/backend";
import {
  decodeGoodsRequest,
  resolveGoodsCustomerId,
} from "@/features/goods/backend/goods-route";
import {
  defineWorkspaceRoute,
  WorkspaceRouteFailure,
} from "@/shared/backend/workspace-route";

type GoodsCartRouteLayer = Layer.Layer<
  CustomerAccountResolver | GoodsCartService,
  unknown,
  never
>;

type GoodsCartRouteError =
  | GoodsCartRevisionConflict
  | GoodsCartUnavailableError
  | WorkspaceRouteFailure;

export const makeGoodsCartRoutes = (layer: GoodsCartRouteLayer) => {
  const route = (
    operation: string,
    cancellation: "continue-after-disconnect" | "interrupt-on-disconnect",
    handler: (
      request: Request
    ) => Effect.Effect<
      Response,
      GoodsCartRouteError,
      GoodsCartService | CustomerAccountResolver
    >
  ) =>
    defineWorkspaceRoute({ operation, cancellation }, (request) =>
      handler(request).pipe(
        Effect.catchTag("GoodsCartRevisionConflict", ({ current }) =>
          Effect.succeed(
            NextResponse.json(
              { error: "Cart changed on another request.", cart: current },
              {
                status: 409,
                headers: { "Cache-Control": "private, no-store" },
              }
            )
          )
        ),
        Effect.provide(layer),
        Effect.mapError((cause) =>
          cause instanceof WorkspaceRouteFailure
            ? cause
            : WorkspaceRouteFailure.internal(
                "Goods cart is temporarily unavailable."
              )(cause)
        )
      )
    );

  return {
    GET: route("goods.cart.get", "interrupt-on-disconnect", () =>
      Effect.gen(function* () {
        const customerId = yield* resolveGoodsCustomerId();
        const cart = yield* GoodsCartService;
        return yield* cart.get(customerId).pipe(Effect.map(cartResponse));
      })
    ),
    PUT: route("goods.cart.set", "continue-after-disconnect", (request) =>
      Effect.gen(function* () {
        const input = yield* decodeGoodsRequest(
          request,
          setGoodsCartItemInputSchema
        );
        const customerId = yield* resolveGoodsCustomerId();
        const cart = yield* GoodsCartService;
        return yield* cart
          .setItem(customerId, input)
          .pipe(Effect.map(cartResponse));
      })
    ),
    DELETE: route("goods.cart.remove", "continue-after-disconnect", (request) =>
      Effect.gen(function* () {
        const input = yield* decodeGoodsRequest(
          request,
          removeGoodsCartItemInputSchema
        );
        const customerId = yield* resolveGoodsCustomerId();
        const cart = yield* GoodsCartService;
        return yield* cart
          .removeItem(customerId, input)
          .pipe(Effect.map(cartResponse));
      })
    ),
  };
};

const cartResponse = (cart: Parameters<typeof NextResponse.json>[0]) =>
  NextResponse.json(cart, {
    headers: { "Cache-Control": "private, no-store" },
  });

const goodsCartRouteLayer = Layer.merge(
  CustomerAccountResolver.Live,
  GoodsCartService.Live
);

export const { DELETE, GET, PUT } = makeGoodsCartRoutes(goodsCartRouteLayer);
