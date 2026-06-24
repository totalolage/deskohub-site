import { DotyposService as SharedDotyposService } from "@deskohub/dotypos";
import type { Category, Product } from "@deskohub/dotypos/generated";
import { Context, Effect, Layer } from "effect";
import { isCategoryDisplayable } from "../utils/category-utils";
import { DotyposConfigFromEnv } from "./dotypos-config.layer";

export const SharedDotyposServiceFromEnv = SharedDotyposService.Default.pipe(
  Layer.provide(DotyposConfigFromEnv)
);

export interface DotyposServiceShape {
  readonly getMenuItems: () => Effect.Effect<
    {
      readonly products: Product[];
      readonly categories: Category[];
    },
    unknown
  >;
}

export class DotyposService extends Context.Service<
  DotyposService,
  DotyposServiceShape
>()("DotyposService") {
  static DefaultWithoutDependencies = Layer.effect(
    this,
    Effect.gen(function* () {
      const dotypos = yield* SharedDotyposService;

      return {
        getMenuItems: Effect.fn("getMenuItems")(
          function* () {
            yield* Effect.logInfo("Dotypos menu item load started");

            const categories = yield* dotypos.getCategories();
            yield* Effect.logInfo("Dotypos menu categories loaded");

            const displayableCategories = categories
              .filter((category) => category.id)
              .filter(isCategoryDisplayable);

            if (displayableCategories.length === 0) {
              yield* Effect.logWarning(
                "Dotypos menu has no displayable categories"
              );
            }

            const productsByCategory = yield* Effect.all(
              displayableCategories.map((category) =>
                dotypos
                  .getProducts({
                    categoryId: category.id,
                    includeDeleted: false,
                  })
                  .pipe(
                    Effect.catch((cause) =>
                      Effect.logWarning(
                        "Dotypos category products load failed",
                        { category, cause }
                      ).pipe(Effect.as([]))
                    )
                  )
              ),
              { concurrency: "inherit" }
            );
            yield* Effect.logInfo("Dotypos menu products loaded");

            const productMap = new Map<string, Product>();
            for (const categoryProducts of productsByCategory) {
              for (const product of categoryProducts) {
                if (product.id && product.display && !product.deleted) {
                  productMap.set(product.id, product);
                }
              }
            }

            return {
              products: Array.from(productMap.values()),
              categories,
            };
          },
          (effect) => effect.pipe(Effect.scoped)
        ),
      };
    })
  );

  static Default = this.DefaultWithoutDependencies.pipe(
    Layer.provide(SharedDotyposServiceFromEnv)
  );
}
