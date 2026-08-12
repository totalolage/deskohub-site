import { describe, expect, test } from "bun:test";
import {
  DotyposCategoryIdSchema,
  DotyposProductIdSchema,
} from "@deskohub/dotypos";
import { Effect } from "effect";
import { plainDateStringSchema } from "@/shared/utils/temporal";
import { normalizeMobileShopCart, quoteMobileShopCart } from "./cart";
import type { MobileShopCatalog } from "./contracts";

const categoryId = DotyposCategoryIdSchema.make("drinks");
const productId = DotyposProductIdSchema.make("water");
const secondProductId = DotyposProductIdSchema.make("snack");
const taxRegime = {
  kind: "not-vat-payer" as const,
  version: "non-vat-v1",
  effectiveFrom: plainDateStringSchema.make("2026-01-01"),
};
const catalog: MobileShopCatalog = {
  version: "catalog-v1",
  generatedAt: "2026-08-11T10:00:00Z" as MobileShopCatalog["generatedAt"],
  categories: [{ id: categoryId, name: "Drinks", order: 0 }],
  products: [
    {
      id: productId,
      categoryId,
      name: "Water",
      canonicalName: "Water",
      price: { value: 2550, exponent: 2, currency: "CZK" },
      version: "water-v1",
    },
    {
      id: secondProductId,
      categoryId,
      name: "Snack",
      canonicalName: "Snack",
      price: { value: 1000, exponent: 2, currency: "CZK" },
      version: "snack-v1",
    },
  ],
};

describe("mobile shop cart and quote", () => {
  test("normalizes duplicate lines before enforcing the per-product limit", async () => {
    const normalized = await Effect.runPromise(
      normalizeMobileShopCart([
        { productId: secondProductId, quantity: 2 },
        { productId, quantity: 3 },
        { productId, quantity: 4 },
      ])
    );
    expect(normalized).toEqual([
      { productId: secondProductId, quantity: 2 },
      { productId, quantity: 7 },
    ]);

    const failure = await Effect.runPromise(
      Effect.flip(
        normalizeMobileShopCart([
          { productId, quantity: 6 },
          { productId, quantity: 5 },
        ])
      )
    );
    expect(failure.code).toBe("quantity_limit_exceeded");
  });

  test("enforces the total quantity limit independently of line count", async () => {
    const ids = ["a", "b", "c", "d"].map(DotyposProductIdSchema.make);
    const failure = await Effect.runPromise(
      Effect.flip(
        normalizeMobileShopCart(
          ids.map((id) => ({ productId: id, quantity: 8 }))
        )
      )
    );
    expect(failure.code).toBe("quantity_limit_exceeded");
  });

  test("builds exact integer totals and a five-minute immutable quote", async () => {
    const quote = await Effect.runPromise(
      quoteMobileShopCart({
        cart: [
          { productId, quantity: 2 },
          { productId: secondProductId, quantity: 1 },
        ],
        catalog,
        locale: "en-US",
        taxRegime,
        now: Temporal.Instant.from("2026-08-11T10:00:00Z"),
      })
    );

    expect(quote.total).toEqual({
      value: 6100,
      exponent: 2,
      currency: "CZK",
    });
    expect(quote.expiresAt).toBe("2026-08-11T10:05:00Z");
    expect(quote.items[0]?.tax).toEqual({ kind: "not-applicable" });
    expect(quote.fingerprint).not.toBeEmpty();

    const laterQuote = await Effect.runPromise(
      quoteMobileShopCart({
        cart: [
          { productId, quantity: 2 },
          { productId: secondProductId, quantity: 1 },
        ],
        catalog,
        locale: "en-US",
        taxRegime,
        now: Temporal.Instant.from("2026-08-11T10:01:00Z"),
      })
    );
    expect(laterQuote.expiresAt).not.toBe(quote.expiresAt);
    expect(laterQuote.fingerprint).toBe(quote.fingerprint);
  });

  test("rejects stale products and refuses to activate VAT without tax facts", async () => {
    const stale = await Effect.runPromise(
      Effect.flip(
        quoteMobileShopCart({
          cart: [
            {
              productId: DotyposProductIdSchema.make("removed"),
              quantity: 1,
            },
          ],
          catalog,
          locale: "en-US",
          taxRegime,
          now: Temporal.Instant.from("2026-08-11T10:00:00Z"),
        })
      )
    );
    expect(stale.code).toBe("catalog_changed");

    const vat = await Effect.runPromise(
      Effect.flip(
        quoteMobileShopCart({
          cart: [{ productId, quantity: 1 }],
          catalog,
          locale: "en-US",
          taxRegime: {
            kind: "vat-payer",
            version: "vat-v1",
            effectiveFrom: plainDateStringSchema.make("2027-01-01"),
            vatId: "CZ123",
          },
          now: Temporal.Instant.from("2027-01-01T10:00:00Z"),
        })
      )
    );
    expect(vat.code).toBe("catalog_unavailable");
  });
});
