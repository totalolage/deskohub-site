import { DotyposService as SharedDotyposService } from "@deskohub/dotypos/backend/service";
import type { Product } from "@deskohub/dotypos/generated";
import { Effect, Layer } from "effect";
import { DotyposRuntimeConfigLive } from "@/shared/backend/config/dotypos.config";
import { isCategoryDisplayable } from "../utils/category-utils";

export class DotyposService extends Effect.Service<DotyposService>()(
  "DotyposService",
  {
    effect: Effect.gen(function* () {
      const sharedDotypos = yield* SharedDotyposService;

      const getMenuItems = Effect.fn("getMenuItems")(
        function* () {
          yield* Effect.logInfo("Dotypos menu item load started");

          const categories = yield* sharedDotypos.getCategories();
          yield* Effect.annotateLogsScoped({ categories });
          yield* Effect.logInfo("Dotypos menu categories loaded");

          const displayableCategories = categories
            .filter((category) => category.id)
            .filter(isCategoryDisplayable);
          yield* Effect.annotateLogsScoped({ displayableCategories });

          if (displayableCategories.length === 0) {
            yield* Effect.logWarning(
              "Dotypos menu has no displayable categories"
            );
          }

          const productsByCategory = yield* Effect.all(
            displayableCategories.map((category) =>
              sharedDotypos
                .getProducts({
                  categoryId: category.id,
                  includeDeleted: false,
                })
                .pipe(
                  Effect.tapError((cause) =>
                    Effect.logWarning("Dotypos category products load failed", {
                      category,
                      cause,
                    })
                  ),
                  Effect.orElseSucceed(() => [])
                )
            ),
            { concurrency: "inherit" }
          );
          yield* Effect.annotateLogsScoped({ productsByCategory });
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
      );

      return {
        ...sharedDotypos,
        getMenuItems,
      };
    }),
    dependencies: [
      Layer.provide(SharedDotyposService.Default, DotyposRuntimeConfigLive),
    ],
  }
) {}
