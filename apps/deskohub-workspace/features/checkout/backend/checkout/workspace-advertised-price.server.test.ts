import "@/shared/testing/workspace-test-env";
import { describe, expect, mock, test } from "bun:test";
import { Effect, Schema } from "effect";
import {
  discountAdvertisementQuoteCodec,
  discountIdSchema,
} from "@/features/discounts/contracts";
import { DiscountServiceMock } from "@/features/discounts/discount.service.mock";

mock.module("server-only", () => ({}));

const { openAdvertisedPriceState } = await import("./advertised-price-state");
const { buildWorkspaceAdvertisedPrice } = await import(
  "./workspace-advertised-price.server"
);
const { affirmWorkspaceAdvertisedPrice } = await import(
  "./workspace-checkout-quote.server"
);

const money = (value: number) => ({
  value,
  exponent: 2,
  currency: "CZK",
});

describe("buildWorkspaceAdvertisedPrice", () => {
  test("returns a source-neutral sealed Calendar advertisement", async () => {
    const advertise = mock(({ discountableSubtotal, product }) =>
      Effect.succeed(
        discountAdvertisementQuoteCodec.make({
          product,
          discountableSubtotal,
          discounts: [
            {
              discount: {
                id: Schema.decodeUnknownSync(discountIdSchema)("summer-sale"),
                label: "Summer sale",
                adjustment: { kind: "percentage", basisPoints: 5000 },
              },
              subtotalBefore: discountableSubtotal,
              amount: money(17_500),
              subtotalAfter: money(17_500),
            },
          ],
          totalDiscount: money(17_500),
          discountedSubtotal: money(17_500),
        })
      )
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

    const result = await buildWorkspaceAdvertisedPrice(input).pipe(
      Effect.provide(DiscountServiceMock({ advertise })),
      Effect.runPromise
    );
    const state = await openAdvertisedPriceState(
      result.advertisedPriceToken
    ).pipe(Effect.runPromise);

    expect(advertise).toHaveBeenCalledWith({
      product: { kind: "cowork", tier: "basic" },
      discountableSubtotal: money(35_000),
      reservationDate: "2026-07-30",
      locale: "en-US",
    });
    expect(result.quote.summary.total).toEqual(money(22_500));
    expect(state.reservation).toEqual(input.reservation);
    expect(state.quote).toEqual(result.quote);
    expect(JSON.stringify(result)).not.toMatch(
      /providerNamespace|providerReference|calendarId|eventReference|storedDiscountId|operatorTitle|dotyposCustomerId|submittedCode/
    );
  });

  test("maps exactly the advertised discount identities into fresh affirmation", async () => {
    const advertisedDiscountId =
      Schema.decodeUnknownSync(discountIdSchema)("summer-sale");
    const advertisementQuote = discountAdvertisementQuoteCodec.make({
      product: { kind: "cowork", tier: "basic" },
      discountableSubtotal: money(35_000),
      discounts: [
        {
          discount: {
            id: advertisedDiscountId,
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
    const affirmAdvertisement = mock(() => Effect.succeed(advertisementQuote));
    const advertised = await buildWorkspaceAdvertisedPrice({
      locale: "en-US",
      reservation: {
        kind: "cowork",
        details: {
          entryTier: "basic",
          coffee: true,
          date: "2026-07-30",
        },
      },
    }).pipe(
      Effect.provide(
        DiscountServiceMock({
          advertise: () => Effect.succeed(advertisementQuote),
        })
      ),
      Effect.runPromise
    );

    const affirmed = await affirmWorkspaceAdvertisedPrice({
      reservation: {
        kind: "cowork",
        entryTier: "basic",
        coffee: true,
        date: "2026-07-30",
        name: "Ada Lovelace",
        email: "ada@example.test",
        phone: "+420 777 777 777",
      },
      locale: "en-US",
      advertisedQuote: advertised.quote,
    }).pipe(
      Effect.provide(DiscountServiceMock({ affirmAdvertisement })),
      Effect.runPromise
    );

    expect(affirmAdvertisement).toHaveBeenCalledWith(
      expect.objectContaining({
        acceptedDiscountIds: [advertisedDiscountId],
      })
    );
    expect(affirmed.quote.payment.discounts).toHaveLength(1);
    expect(affirmed.quote.summary.total).toEqual(money(22_500));
  });
});
