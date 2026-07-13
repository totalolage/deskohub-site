import { describe, expect, test } from "bun:test";
import { decodeStandardSchema } from "@deskohub/standard-schema";
import { Effect, Layer } from "effect";
import {
  type DiscountCommitment,
  type DiscountQuote,
  type DiscountQuoteInput,
  DiscountService,
  discountProductIdentitySchema,
  type IDiscountService,
} from "./index";

const quote: DiscountQuote = {
  product: { kind: "cowork", tier: "basic" },
  discountableSubtotal: { value: 35_000, exponent: 2, currency: "CZK" },
  discounts: [],
  totalDiscount: { value: 0, exponent: 2, currency: "CZK" },
  discountedSubtotal: { value: 35_000, exponent: 2, currency: "CZK" },
};

describe("discount contracts", () => {
  test("decodes every current cowork product identity", () => {
    expect(
      ["basic", "plus", "profi"].map((tier) =>
        decodeStandardSchema(discountProductIdentitySchema, {
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

  test("strictly rejects unknown product kinds, tiers, and fields", () => {
    expect(
      decodeStandardSchema(discountProductIdentitySchema, {
        kind: "event",
        tier: "basic",
      })
    ).toBeUndefined();
    expect(
      decodeStandardSchema(discountProductIdentitySchema, {
        kind: "cowork",
        tier: "enterprise",
      })
    ).toBeUndefined();
    expect(
      decodeStandardSchema(discountProductIdentitySchema, {
        kind: "cowork",
        tier: "basic",
        roomId: "private-provider-field",
      })
    ).toBeUndefined();
  });

  test("supports source-neutral service test layers", async () => {
    const service: IDiscountService = {
      quote: () => Effect.succeed(quote),
      revalidate: () =>
        Effect.succeed({
          quote,
          commitment: {} as DiscountCommitment,
        }),
    };
    const input: DiscountQuoteInput = {
      product: quote.product,
      discountableSubtotal: quote.discountableSubtotal,
      reservationDate: "2026-07-14",
      dotyposCustomerId: "customer-1",
      locale: "en-US",
    };

    const result = await Effect.gen(function* () {
      const discounts = yield* DiscountService;
      return yield* discounts.quote(input);
    }).pipe(
      Effect.provide(Layer.succeed(DiscountService, service)),
      Effect.runPromise
    );

    expect(result).toEqual(quote);
  });
});
