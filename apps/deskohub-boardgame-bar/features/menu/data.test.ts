import { describe, expect, mock, test } from "bun:test";
import type { Category, Product } from "@deskohub/dotypos/generated";
import { Effect, Layer } from "effect";
import { setBoardgameTestEnv } from "@/shared/testing/boardgame-test-env";
import { siteConstants } from "@/shared/utils/constants";

setBoardgameTestEnv();

const category = (overrides: Partial<Category>): Category => ({
  id: "category-id",
  name: "Category",
  display: true,
  deleted: false,
  ...overrides,
});

const product = (overrides: Partial<Product>): Product => ({
  id: "product-id",
  _categoryId: "category-id",
  name: "Product",
  display: true,
  deleted: false,
  priceWithoutVat: "100",
  vat: "21",
  ...overrides,
});

const runMenuData = async (input: {
  categories: Category[];
  products: Product[];
}) => {
  const [{ DotyposService }, { MenuService }] = await Promise.all([
    import("@/features/dotypos"),
    import("./data"),
  ]);

  return Effect.runPromise(
    Effect.gen(function* () {
      const menuService = yield* MenuService;
      return yield* menuService.getMenuData();
    }).pipe(
      Effect.provide(MenuService.DefaultWithoutDependencies),
      Effect.provide(
        Layer.succeed(DotyposService, {
          getMenuItems: mock(() => Effect.succeed(input)),
        })
      )
    )
  );
};

describe("MenuService", () => {
  test("orders configured categories and appends only uncategorized categories with products", async () => {
    const [first, second, hiddenId] = siteConstants.menu.categoryGroups.food;
    const extraWithProduct = "extra-with-product";
    const extraWithoutProduct = "extra-without-product";

    const result = await runMenuData({
      categories: [
        category({ id: second, name: "Second" }),
        category({ id: first, name: "First" }),
        category({ id: hiddenId, name: "Hidden", display: false }),
        category({ id: extraWithoutProduct, name: "No products" }),
        category({ id: extraWithProduct, name: "Has products" }),
      ],
      products: [
        product({ id: "first-product", _categoryId: first }),
        product({ id: "second-product", _categoryId: second }),
        product({ id: "extra-product", _categoryId: extraWithProduct }),
      ],
    });

    expect(result.categories.map((item) => item.id)).toEqual([
      first,
      second,
      extraWithProduct,
    ]);
    expect(result.products.map((item) => item.id)).toEqual([
      "first-product",
      "second-product",
      "extra-product",
    ]);
  });
});
