import { describe, expect, test } from "bun:test";
import {
  type DotyposCategory,
  DotyposCategoryIdSchema,
  type DotyposProduct,
  DotyposProductIdSchema,
} from "@deskohub/dotypos";
import { plainDateStringSchema } from "@/shared/utils/temporal";
import { mapDotyposMobileShopCatalog } from "./catalog";

const drinksId = DotyposCategoryIdSchema.make("drinks");
const foodId = DotyposCategoryIdSchema.make("food");

const category = (
  input: Partial<DotyposCategory> & Pick<DotyposCategory, "id" | "name">
): DotyposCategory => ({
  id: input.id,
  name: input.name,
  ...input,
});

const product = (
  input: Partial<DotyposProduct> & Pick<DotyposProduct, "id" | "name">
): DotyposProduct => ({
  id: input.id,
  _categoryId: drinksId,
  name: input.name,
  priceWithoutVat: "25.00",
  vat: "0",
  display: true,
  tags: ["self-service"],
  ...input,
});

const policy = {
  finalPriceField: "priceWithoutVat" as const,
  taxRegime: {
    kind: "not-vat-payer" as const,
    version: "non-vat-v1",
    effectiveFrom: plainDateStringSchema.make("2026-01-01"),
  },
};

describe("mobile shop catalog mapping", () => {
  test("requires the exact self-service tag and applies explicit deny tags", () => {
    const validId = DotyposProductIdSchema.make("valid");
    const exactStringId = DotyposProductIdSchema.make("exact-string");
    const mapped = mapDotyposMobileShopCatalog({
      categories: [category({ id: drinksId, name: "Drinks" })],
      products: [
        product({ id: validId, name: "Water", stockDeduct: false }),
        product({
          id: exactStringId,
          name: "Tea",
          tags: "self-service",
        }),
        product({
          id: DotyposProductIdSchema.make("substring"),
          name: "Substring",
          tags: "self-service,featured",
        }),
        product({
          id: DotyposProductIdSchema.make("alcohol"),
          name: "Alcohol",
          tags: ["self-service", "alcohol"],
        }),
        product({
          id: DotyposProductIdSchema.make("hidden"),
          name: "Hidden",
          display: false,
        }),
      ],
      locale: "en-US",
      generatedAt: Temporal.Instant.from("2026-08-11T10:00:00Z"),
      policy,
    });

    expect(mapped.catalog.products.map(({ id }) => id)).toEqual([
      exactStringId,
      validId,
    ]);
    expect(mapped.stockFulfillmentFacts.get(validId)).toEqual({
      productId: validId,
      stockDeductionEnabled: false,
      role: "backend-informative-only",
    });
    expect(mapped.catalog.products[0]).not.toHaveProperty("stockDeduct");
    expect(mapped.catalog.products[0]).not.toHaveProperty("stock");
  });

  test("filters invalid categories and exact positive prices without guessing the provider field", () => {
    const validId = DotyposProductIdSchema.make("valid");
    const mapped = mapDotyposMobileShopCatalog({
      categories: [
        category({ id: drinksId, name: "Drinks", ordering: "20" }),
        category({ id: foodId, name: "Food", ordering: "10" }),
        category({
          id: DotyposCategoryIdSchema.make("non-menu"),
          name: "Internal",
          tags: ["non-menu"],
        }),
      ],
      products: [
        product({
          id: validId,
          name: "Water",
          _categoryId: drinksId,
          priceWithoutVat: "12.34",
          priceWithVat: "99.00",
        }),
        product({
          id: DotyposProductIdSchema.make("food"),
          name: "Snack",
          _categoryId: foodId,
          priceWithoutVat: "10.001",
        }),
        product({
          id: DotyposProductIdSchema.make("zero"),
          name: "Free",
          priceWithoutVat: "0",
        }),
      ],
      locale: "en-US",
      generatedAt: Temporal.Instant.from("2026-08-11T10:00:00Z"),
      policy,
    });

    expect(mapped.catalog.categories.map(({ id }) => id)).toEqual([drinksId]);
    expect(mapped.catalog.products).toHaveLength(1);
    expect(mapped.catalog.products[0]?.price).toEqual({
      value: 1234,
      exponent: 2,
      currency: "CZK",
    });
  });

  test("uses full/base/canonical translation fallback and sanitizes images", () => {
    const mapped = mapDotyposMobileShopCatalog({
      categories: [
        category({
          id: drinksId,
          name: "Canonical category",
          translatedName: { cs: "Nápoje" },
        }),
      ],
      products: [
        product({
          id: DotyposProductIdSchema.make("water"),
          name: "Canonical water",
          translatedName: { cs: "Voda" },
          imageUrl: "http://insecure.example/water.png",
        }),
      ],
      locale: "cs-CZ",
      generatedAt: Temporal.Instant.from("2026-08-11T10:00:00Z"),
      policy,
    });

    expect(mapped.catalog.categories[0]?.name).toBe("Nápoje");
    expect(mapped.catalog.products[0]).toMatchObject({
      name: "Voda",
      canonicalName: "Canonical water",
    });
    expect(mapped.catalog.products[0]).not.toHaveProperty("imageUrl");
  });
});
