import {
  type DotyposCategory,
  type DotyposProduct,
  type DotyposProductId,
  DotyposService as SharedDotyposService,
} from "@deskohub/dotypos";
import { Context, Effect, Layer } from "effect";
import { isCategoryDisplayable } from "../utils/category-utils";
import { DotyposConfigFromEnv } from "./dotypos-config.layer";

export interface DotyposServiceShape {
  readonly getMenuItems: Effect.Effect<
    {
      readonly products: DotyposProduct[];
      readonly categories: DotyposCategory[];
    },
    unknown
  >;
}

export class DotyposService extends Context.Service<
  DotyposService,
  DotyposServiceShape
>()("DotyposService") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const dotypos = yield* SharedDotyposService;

      return {
        getMenuItems: Effect.gen(function* () {
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
                    Effect.logWarning("Dotypos category products load failed", {
                      category,
                      cause,
                    }).pipe(Effect.as([]))
                  )
                )
            ),
            { concurrency: "inherit" }
          );
          yield* Effect.logInfo("Dotypos menu products loaded");

          const productMap = new Map<DotyposProductId, DotyposProduct>();
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
        }).pipe(Effect.scoped, Effect.withSpan("DotyposService.getMenuItems")),
      };
    })
  );

  static Live = this.Default.pipe(
    Layer.provide(
      SharedDotyposService.Live.pipe(Layer.provide(DotyposConfigFromEnv))
    )
  );
}
