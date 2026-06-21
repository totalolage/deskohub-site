import type { Category, Product } from "@deskohub/dotypos/generated";
import { Context, Data, Effect, Layer } from "effect";
import { DotyposService, isCategoryDisplayable } from "@/features/dotypos";
import { siteConstants } from "@/shared/utils/constants";

class MenuDataError extends Data.TaggedError("MenuDataError")<{
  readonly cause?: unknown;
  readonly message: string;
}> {}

export interface MenuDataShape {
  readonly products: Product[];
  readonly categories: Category[];
}

interface MenuServiceShape {
  readonly getMenuData: () => Effect.Effect<MenuDataShape, MenuDataError>;
}

export class MenuService extends Context.Service<
  MenuService,
  MenuServiceShape
>()("MenuService") {
  static DefaultWithoutDependencies = Layer.effect(
    this,
    Effect.gen(function* () {
      const dotypos = yield* DotyposService;

      return {
        getMenuData: Effect.fn("getMenuData")(
          function* () {
            yield* Effect.logInfo("Generating menu props");

            const { products, categories } = yield* dotypos.getMenuItems();
            yield* Effect.logDebug("Menu items fetched", {
              products,
              categories,
            });

            const categoryOrder = [
              ...siteConstants.menu.categoryGroups.food,
              ...siteConstants.menu.categoryGroups.drinks,
            ];
            const displayCategories: Category[] = [];
            for (const categoryId of categoryOrder) {
              const category = categories.find((cat) => cat.id === categoryId);
              if (!category) {
                yield* Effect.logDebug("Category skipped; not found", {
                  categoryId,
                });
                continue;
              }

              if (!isCategoryDisplayable(category)) {
                yield* Effect.logDebug("Category skipped; not displayable", {
                  category,
                });
                continue;
              }

              yield* Effect.logDebug("Category added to display list", {
                category,
              });
              displayCategories.push(category);
            }

            yield* Effect.logDebug("Display categories generated", {
              displayCategories,
            });

            if (siteConstants.menu.showUncategorized) {
              const processedIds = new Set(categoryOrder);

              categories.forEach((category) => {
                if (
                  category.id &&
                  !processedIds.has(category.id) &&
                  isCategoryDisplayable(category)
                ) {
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
          },
          (effect) =>
            effect.pipe(
              Effect.annotateLogs("service", "MenuService"),
              Effect.mapError(
                (error) =>
                  new MenuDataError({
                    message: "Failed to generate menu props",
                    cause: error,
                  })
              )
            )
        ),
      };
    })
  );

  static Default = this.DefaultWithoutDependencies.pipe(
    Layer.provide(DotyposService.Default)
  );

  static Error = MenuDataError;
}

export const MenuData = Object.assign(
  Effect.gen(function* () {
    const menuService = yield* MenuService;
    return yield* menuService.getMenuData();
  }),
  {
    Default: MenuService.Default,
    DefaultWithoutDependencies: MenuService.DefaultWithoutDependencies,
    Error: MenuDataError,
  }
);
