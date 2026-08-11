import {
  type DotyposCategory,
  type DotyposProduct,
  DotyposService,
} from "@deskohub/dotypos";
import { Context, Effect, Layer, Schema } from "effect";
import { plainDateStringSchema } from "@/shared/utils/temporal";
import type { MobileShopCatalogMappingPolicy } from "../catalog";
import { MobileShopFailure } from "../errors";

export interface MobileShopCatalogSourceSnapshot {
  /** Complete paginated provider result, not a first-page approximation. */
  readonly categories: readonly DotyposCategory[];
  readonly products: readonly DotyposProduct[];
}

export interface IMobileShopCatalogSource {
  readonly loadAll: Effect.Effect<
    MobileShopCatalogSourceSnapshot,
    MobileShopFailure
  >;
}

export class MobileShopCatalogSource extends Context.Service<
  MobileShopCatalogSource,
  IMobileShopCatalogSource
>()("@deskohub-workspace/mobile-shop/MobileShopCatalogSource") {
  static Unavailable = Layer.succeed(this, {
    loadAll: MobileShopFailure.integrationUnavailable(
      "Dotypos paginated catalog operations have not been installed."
    ),
  });

  static Dotypos = Layer.effect(
    this,
    Effect.gen(function* () {
      const dotypos = yield* DotyposService;

      return {
        loadAll: Effect.all(
          {
            categories: dotypos.getCategories(),
            products: dotypos.getProducts({ includeDeleted: true }),
          },
          { concurrency: "inherit" }
        ).pipe(
          Effect.mapError(
            (cause) =>
              new MobileShopFailure({ code: "catalog_unavailable", cause })
          )
        ),
      } satisfies IMobileShopCatalogSource;
    })
  );
}

export interface IMobileShopCatalogPolicy {
  readonly current: Effect.Effect<
    MobileShopCatalogMappingPolicy,
    MobileShopFailure
  >;
}

export class MobileShopCatalogPolicy extends Context.Service<
  MobileShopCatalogPolicy,
  IMobileShopCatalogPolicy
>()("@deskohub-workspace/mobile-shop/MobileShopCatalogPolicy") {
  static Unavailable = Layer.succeed(this, {
    current: MobileShopFailure.integrationUnavailable(
      "The verified Dotypos final-price mapping has not been installed."
    ),
  });

  static DesktechubNonVat = Layer.succeed(this, {
    current: Effect.sync(
      () =>
        ({
          finalPriceField: "priceWithoutVat",
          taxRegime: {
            kind: "not-vat-payer",
            version: "desktechub-non-vat-2026-08",
            effectiveFrom: Schema.decodeUnknownSync(plainDateStringSchema)(
              "2026-08-11"
            ),
          },
        }) satisfies MobileShopCatalogMappingPolicy
    ),
  });
}
