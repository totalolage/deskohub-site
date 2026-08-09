import "@/shared/testing/workspace-test-env";
import { describe, expect, test } from "bun:test";
import { decodeStandardSchema } from "@deskohub/standard-schema";
import { Effect, Schema } from "effect";
import {
  type DiscountQuote,
  type DiscountQuoteInput,
  discountAdvertisementQuoteCodec,
  discountIdSchema,
  discountProductTargetSchema,
} from "./contracts";
import { DiscountService } from "./discount.service";
import { DiscountServiceMock } from "./discount.service.mock";

const quote: DiscountQuote = {
  product: { kind: "cowork", tier: "basic" },
  discountableSubtotal: { value: 35_000, exponent: 2, currency: "CZK" },
  discounts: [],
  totalDiscount: { value: 0, exponent: 2, currency: "CZK" },
  discountedSubtotal: { value: 35_000, exponent: 2, currency: "CZK" },
};

describe("discount contracts", () => {
  test("brands non-empty opaque discount IDs", () => {
    const decodeDiscountId = Schema.decodeUnknownSync(discountIdSchema);

    expect(decodeDiscountId("opaque-discount-id")).toBe("opaque-discount-id");
    expect(() => decodeDiscountId("")).toThrow();
  });

  test("decodes every current cowork product target", () => {
    expect(
      ["basic", "plus", "profi"].map((tier) =>
        decodeStandardSchema(discountProductTargetSchema, {
          kind: "cowork",
          tier,
        })
      )
    ).toEqual([
      { kind: "cowork", tier: "basic" },
      { kind: "cowork", tier: "plus" },
      { kind: "cowork", tier: "profi" },
    ]);
  });

  test("decodes every meeting-room product target", () => {
    const products = [
      { kind: "meeting-room", duration: { unit: "hour", amount: 1 } },
      { kind: "meeting-room", duration: { unit: "hour", amount: 4 } },
      { kind: "meeting-room", duration: { unit: "day", amount: 1 } },
    ] as const;

    expect(
      products.map((product) =>
        decodeStandardSchema(discountProductTargetSchema, product)
      )
    ).toEqual(products);
  });

  test("keeps the office family target separate from exact office products", () => {
    expect(
      decodeStandardSchema(discountProductTargetSchema, { kind: "office" })
    ).toEqual({ kind: "office" });
    expect(
      decodeStandardSchema(discountProductTargetSchema, {
        kind: "office",
        seats: 3,
        dayCount: 2,
      })
    ).toBeUndefined();
  });

  test("strictly rejects unknown product kinds, tiers, durations, and fields", () => {
    expect(
      decodeStandardSchema(discountProductTargetSchema, {
        kind: "event",
        tier: "basic",
      })
    ).toBeUndefined();
    expect(
      decodeStandardSchema(discountProductTargetSchema, {
        kind: "meeting-room",
        duration: { unit: "hour", amount: 2 },
      })
    ).toBeUndefined();
    expect(
      decodeStandardSchema(discountProductTargetSchema, {
        kind: "cowork",
        tier: "enterprise",
      })
    ).toBeUndefined();
    expect(
      decodeStandardSchema(discountProductTargetSchema, {
        kind: "cowork",
        tier: "basic",
        roomId: "private-provider-field",
      })
    ).toBeUndefined();
  });

  test("supports source-neutral service test layers", async () => {
    const input: DiscountQuoteInput = {
      product: quote.product,
      discountableSubtotal: quote.discountableSubtotal,
      reservationDate: "2026-07-14",
      dotyposCustomerId: "customer-1",
      locale: "en-US",
      submittedCode: undefined,
    };

    const result = await Effect.gen(function* () {
      const discounts = yield* DiscountService;
      return yield* discounts.discoverAdvertisedDiscounts(input);
    }).pipe(
      Effect.provide(
        DiscountServiceMock({
          discoverAdvertisedDiscounts: () =>
            Effect.succeed(discountAdvertisementQuoteCodec.make(quote)),
        })
      ),
      Effect.runPromise
    );

    expect(result).toEqual(quote);
  });
});
