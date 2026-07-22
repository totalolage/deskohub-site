import "@/shared/testing/workspace-test-env";
import { describe, expect, mock, test } from "bun:test";
import { Effect, Schema } from "effect";
import { calculateWorkspaceCheckoutQuote } from "@/features/checkout/checkout-quote";
import {
  discountAdvertisementQuoteCodec,
  discountIdSchema,
} from "@/features/discounts/contracts";
import { CheckoutPricingServiceMock } from "./checkout-pricing.service.mock";

mock.module("server-only", () => ({}));

const { openAdvertisedPriceState } = await import("./advertised-price-state");
const { buildAdvertisedPrice } = await import("./advertised-price.server");

const money = (value: number) => ({
  value,
  exponent: 2,
  currency: "CZK",
});

describe("buildAdvertisedPrice", () => {
  test("seals the source-neutral quote returned by pricing", async () => {
    const discountQuote = discountAdvertisementQuoteCodec.make({
      product: { kind: "cowork", tier: "basic" },
      discountableSubtotal: money(35_000),
      discounts: [
        {
          discount: {
            id: Schema.decodeUnknownSync(discountIdSchema)("summer-sale"),
            label: "Summer sale",
            adjustment: { kind: "percentage", basisPoints: 5000 },
          },
          subtotalBefore: money(35_000),
          amount: money(17_500),
          subtotalAfter: money(17_500),
        },
      ],
      totalDiscount: money(17_500),
      discountedSubtotal: money(17_500),
    });
    const quoteAdvertisement = mock(({ reservation }) =>
      calculateWorkspaceCheckoutQuote(reservation, { discountQuote })
    );
    const input = {
      locale: "en-US" as const,
      reservation: {
        kind: "cowork" as const,
        details: {
          entryTier: "basic" as const,
          coffee: true,
          date: "2026-07-30",
        },
      },
    };

    const result = await buildAdvertisedPrice(input).pipe(
      Effect.provide(CheckoutPricingServiceMock({ quoteAdvertisement })),
      Effect.runPromise
    );
    const state = await openAdvertisedPriceState(
      result.advertisedPriceToken
    ).pipe(Effect.runPromise);

    expect(quoteAdvertisement).toHaveBeenCalledWith({
      reservation: input.reservation.details,
      locale: "en-US",
    });
    expect(result.quote.summary.total).toEqual(money(22_500));
    expect(state.reservation).toEqual(input.reservation);
    expect(state.quote).toEqual(result.quote);
    expect(JSON.stringify(result)).not.toMatch(
      /providerNamespace|providerReference|calendarId|eventReference|storedDiscountId|operatorTitle|dotyposCustomerId|submittedCode/
    );
  });
});
