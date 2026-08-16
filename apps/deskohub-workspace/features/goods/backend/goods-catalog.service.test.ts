import { describe, expect, test } from "bun:test";
import {
  DotyposCategorySchema,
  DotyposProductSchema,
  DotyposService,
} from "@deskohub/dotypos";
import { Effect, Layer, Schema } from "effect";
import { GoodsCatalogService } from "./goods-catalog.service";

const category = (input: Partial<typeof DotyposCategorySchema.Encoded>) =>
  Schema.decodeUnknownSync(DotyposCategorySchema)({
    id: "category-id",
    name: "Provider category",
    deleted: false,
    display: true,
    ...input,
  });

const product = (input: Partial<typeof DotyposProductSchema.Encoded>) =>
  Schema.decodeUnknownSync(DotyposProductSchema)({
    id: "product-id",
    _categoryId: "category-id",
    name: "Provider product",
    priceWithoutVat: "125.50",
    vat: "0",
    deleted: false,
    display: true,
    ...input,
  });

const getCatalog = (
  categories: readonly ReturnType<typeof category>[],
  products: readonly ReturnType<typeof product>[],
  locale: "cs-CZ" | "en-US" = "en-US"
) =>
  Effect.runPromise(
    Effect.flatMap(GoodsCatalogService, (service) =>
      service.getCatalog(locale)
    ).pipe(
      Effect.provide(
        GoodsCatalogService.Default.pipe(
          Layer.provide(
            Layer.mock(DotyposService, {
              getCategories: () => Effect.succeed(categories),
              getProducts: () => Effect.succeed(products),
            })
          )
        )
      )
    )
  );

describe("GoodsCatalogService", () => {
  test("projects localized visible products with exact CZK minor units", async () => {
    const catalog = await getCatalog(
      [
        category({
          translatedName: { cs: "Občerstvení", en: "Refreshments" },
        }),
      ],
      [
        product({
          translatedName: { cs: "Sendvič", en: "Sandwich" },
          translatedDescription: {
            cs: " Čerstvý sendvič ",
            en: "Fresh sandwich",
          },
          imageUrl: " https://images.example.test/sandwich.jpg ",
          priceWithVat: "125.50",
          unit: " ks ",
        }),
      ],
      "cs-CZ"
    );

    expect(catalog).toEqual({
      categories: [
        {
          categoryId: "category-id",
          name: "Občerstvení",
          products: [
            {
              identity: {
                kind: "goods",
                categoryId: "category-id",
                productId: "product-id",
              },
              name: "Sendvič",
              description: "Čerstvý sendvič",
              imageUrl: "https://images.example.test/sandwich.jpg",
              unit: "ks",
              unitPrice: { value: 12_550, exponent: 2, currency: "CZK" },
            },
          ],
        },
      ],
    });
  });

  test("falls back to provider names and excludes hidden or deleted data", async () => {
    const catalog = await getCatalog(
      [category({}), category({ id: "hidden-category", display: false })],
      [
        product({}),
        product({ id: "hidden", display: false }),
        product({ id: "deleted", deleted: true }),
        product({ id: "orphan", _categoryId: "hidden-category" }),
        product({
          id: "safe-optional-fields",
          imageUrl: "not a URL",
          unit: " ",
        }),
      ]
    );

    expect(catalog.categories).toHaveLength(1);
    expect(catalog.categories[0]?.name).toBe("Provider category");
    const products = catalog.categories[0]?.products ?? [];
    expect(products.map(({ identity }) => identity.productId)).toEqual([
      "product-id",
      "safe-optional-fields",
    ]);
    expect(products[1]).not.toHaveProperty("imageUrl");
    expect(products[1]).not.toHaveProperty("unit");
  });

  test("rejects prices that cannot be represented exactly in CZK minor units", async () => {
    await expect(
      getCatalog([category({})], [product({ priceWithVat: "125.501" })])
    ).rejects.toMatchObject({ _tag: "GoodsCatalogUnavailableError" });
  });
});
