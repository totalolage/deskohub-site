import type { Category } from "@deskohub/dotypos/generated";
import { Data, Effect } from "effect";
import { DotyposService, isCategoryDisplayable } from "@/features/dotypos";
import { siteConstants } from "@/shared/utils/constants";

class MenuDataError extends Data.TaggedError("MenuDataError")<{
  readonly cause?: unknown;
  readonly message: string;
}> {}

export class MenuData extends Effect.Service<MenuData>()("MenuData", {
  effect: Effect.gen(function* () {
    const dotypos = yield* DotyposService;

    yield* Effect.log("Generating menu props");

    const { products, categories } = yield* dotypos.getMenuItems();
    yield* Effect.logDebug("Menu items fetched", {
      products,
      categories,
    });

    // Get display order for categories from config
    const categoryOrder = [
      ...siteConstants.menu.categoryGroups.food,
      ...siteConstants.menu.categoryGroups.drinks,
    ];
    const displayCategories: Category[] = yield* Effect.all(
      categoryOrder.map((categoryId) =>
        Effect.gen(function* () {
          const category = categories.find((cat) => cat.id === categoryId);
          if (!category) {
            yield* Effect.logDebug("Category skipped; not found", {
              categoryId,
            });
            return yield* Effect.fail(new Error("Not found"));
          }

          const isDisplayable = isCategoryDisplayable(category);
          if (!isDisplayable) {
            yield* Effect.logDebug("Category skipped; not displayable", {
              category,
            });
            return yield* Effect.fail(new Error("Not displayable"));
          }

          yield* Effect.logDebug("Category added to display list", {
            category,
          });

          return category;
        })
      ),
      {
        mode: "validate",
        concurrency: "unbounded",
      }
    );

    yield* Effect.logDebug("Display categories generated", {
      displayCategories,
    });

    // Handle uncategorized items if enabled
    if (siteConstants.menu.showUncategorized) {
      const processedIds = new Set(categoryOrder);

      categories.forEach((category) => {
        // Respect the category's display attribute and tags
        if (
          category.id &&
          !processedIds.has(category.id) &&
          isCategoryDisplayable(category)
        ) {
          // Check if there are products for this category
          const hasProducts = products.some(
            (p) => p._categoryId === category.id
          );
          if (hasProducts) {
            displayCategories.push(category);
          }
        }
      });
    }

    return {
      categories: displayCategories,
      products,
    };
  }).pipe(
    Effect.annotateLogs("service", "MenuService"),
    Effect.mapError(
      (error) =>
        new MenuDataError({
          message: "Failed to generate menu props",
          cause: error,
        })
    )
  ),
  dependencies: [DotyposService.Default],
}) {
  static Error = MenuDataError;
}
