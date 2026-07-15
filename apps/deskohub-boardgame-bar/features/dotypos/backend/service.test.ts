import { describe, expect, mock, test } from "bun:test";
import type { Category, Product } from "@deskohub/dotypos/generated";
import { Effect, Layer } from "effect";
import { setBoardgameTestEnv } from "@/shared/testing/boardgame-test-env";

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

type SharedDotyposServiceShape =
  typeof import("@deskohub/dotypos").DotyposService.Service;
type BoardgameDotyposService = import("./service").DotyposService;
type BoardgameDotyposServiceTag = typeof import("./service").DotyposService;

const runWithShared = async <A, E>(
  makeEffect: (
    service: BoardgameDotyposServiceTag
  ) => Effect.Effect<A, E, BoardgameDotyposService>,
  sharedDotypos: Pick<
    SharedDotyposServiceShape,
    "getCategories" | "getProducts"
  >
) => {
  setBoardgameTestEnv();
  const [{ DotyposService: SharedDotyposService }, { DotyposService }] =
    await Promise.all([import("@deskohub/dotypos"), import("./service")]);

  return Effect.runPromise(
    makeEffect(DotyposService).pipe(
      Effect.provide(DotyposService.DefaultWithoutDependencies),
      Effect.provide(
        Layer.succeed(
          SharedDotyposService,
          sharedDotypos as SharedDotyposServiceShape
        )
      )
    )
  );
};

describe("DotyposService.getMenuItems", () => {
  test("filters categories, dedupes products, and excludes hidden or deleted products", async () => {
    const visible = category({ id: "visible" });
    const alsoVisible = category({ id: "also-visible" });
    const hidden = category({ id: "hidden", display: false });
    const deleted = category({ id: "deleted", deleted: true });
    const nonMenu = category({ id: "non-menu", tags: ["non-menu"] });
    const duplicate = product({ id: "duplicate", _categoryId: "visible" });
    const getProducts = mock(({ categoryId }: { categoryId?: string }) =>
      Effect.succeed(
        categoryId === "visible"
          ? [
              duplicate,
              product({ id: "hidden-product", display: false }),
              product({ id: "deleted-product", deleted: true }),
              product({ id: undefined }),
            ]
          : [product({ ...duplicate, _categoryId: "also-visible" })]
      )
    );

    const result = await runWithShared(
      (DotyposService) =>
        Effect.gen(function* () {
          const dotypos = yield* DotyposService;
          return yield* dotypos.getMenuItems();
        }),
      {
        getCategories: mock(() =>
          Effect.succeed([
            visible,
            hidden,
            deleted,
            nonMenu,
            category({ id: undefined }),
            alsoVisible,
          ])
        ),
        getProducts,
      }
    );

    expect(getProducts).toHaveBeenCalledTimes(2);
    expect(getProducts).toHaveBeenCalledWith({
      categoryId: "visible",
      includeDeleted: false,
    });
    expect(getProducts).toHaveBeenCalledWith({
      categoryId: "also-visible",
      includeDeleted: false,
    });
    expect(result.products).toHaveLength(1);
    expect(result.products[0]?.id).toBe("duplicate");
    expect(result.categories).toEqual([
      visible,
      hidden,
      deleted,
      nonMenu,
      category({ id: undefined }),
      alsoVisible,
    ]);
  });

  test("recovers failed category products load", async () => {
    setBoardgameTestEnv();
    const { ValidationError } = await import("@deskohub/dotypos");

    const result = await runWithShared(
      (DotyposService) =>
        Effect.gen(function* () {
          const dotypos = yield* DotyposService;
          return yield* dotypos.getMenuItems();
        }),
      {
        getCategories: mock(() => Effect.succeed([category({ id: "broken" })])),
        getProducts: mock(() =>
          Effect.fail(new ValidationError({ message: "nope" }))
        ),
      }
    );

    expect(result.products).toEqual([]);
    expect(result.categories).toEqual([category({ id: "broken" })]);
  });
});
