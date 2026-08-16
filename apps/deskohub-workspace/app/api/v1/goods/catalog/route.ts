import { Effect, Layer } from "effect";
import { NextResponse } from "next/server";
import { CustomerAccountResolver } from "@/features/account";
import { GoodsCatalogService } from "@/features/goods/backend";
import { resolveGoodsCustomerId } from "@/features/goods/backend/goods-route";
import { baseLocale, isLocale } from "@/features/i18n";
import {
  defineWorkspaceRoute,
  WorkspaceRouteFailure,
} from "@/shared/backend/workspace-route";

type GoodsCatalogRouteLayer = Layer.Layer<
  CustomerAccountResolver | GoodsCatalogService,
  unknown,
  never
>;

export const makeGoodsCatalogRoute = (layer: GoodsCatalogRouteLayer) =>
  defineWorkspaceRoute(
    {
      operation: "goods.catalog",
      cancellation: "interrupt-on-disconnect",
    },
    (request) =>
      Effect.gen(function* () {
        yield* resolveGoodsCustomerId();
        const catalog = yield* GoodsCatalogService;
        const requestedLocale = new URL(request.url).searchParams.get("locale");
        const locale =
          requestedLocale && isLocale(requestedLocale)
            ? requestedLocale
            : baseLocale;
        const result = yield* catalog.getCatalog(locale);
        return NextResponse.json(result, {
          headers: { "Cache-Control": "private, no-store" },
        });
      }).pipe(
        Effect.provide(layer),
        Effect.mapError((cause) =>
          cause instanceof WorkspaceRouteFailure
            ? cause
            : WorkspaceRouteFailure.internal(
                "Goods catalog is temporarily unavailable."
              )(cause)
        )
      )
  );

const goodsCatalogRouteLayer = Layer.merge(
  CustomerAccountResolver.Live,
  GoodsCatalogService.Live
);

export const GET = makeGoodsCatalogRoute(goodsCatalogRouteLayer);
