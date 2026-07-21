import "@/shared/testing/workspace-test-env";
import { describe, expect, mock, test } from "bun:test";
import { Effect, Layer, Schema } from "effect";
import { calculateWorkspaceCheckoutQuote } from "@/features/checkout/checkout-quote";
import type { WorkspaceMoney } from "@/features/checkout/workspace-money";
import type { DiscountCommitment } from "@/features/discounts";
import {
  affirmedDiscountAdvertisementQuoteCodec,
  discountAdvertisementQuoteCodec,
  discountIdSchema,
} from "@/features/discounts/contracts";
import type { DiscountService } from "@/features/discounts/discount.service";
import { DiscountServiceMock } from "@/features/discounts/discount.service.mock";
import { CheckoutPricingService } from "./checkout-pricing.service";

const money = (value: number): WorkspaceMoney => ({
  value,
  exponent: 2,
  currency: "CZK",
});

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

const affirmedAdvertisement =
  affirmedDiscountAdvertisementQuoteCodec.make(advertisementQuote);

const reservation = {
  entryTier: "basic" as const,
  coffee: true,
  date: "2026-07-30",
};

const runWithDiscounts = <A, E>(
  effect: Effect.Effect<A, E, CheckoutPricingService>,
  discounts: Layer.Layer<DiscountService>
) =>
  effect.pipe(
    Effect.provide(CheckoutPricingService.Live.pipe(Layer.provide(discounts))),
    Effect.runPromise
  );

describe("CheckoutPricingService", () => {
  test("quotes the advertised catalog price with anonymous discounts", async () => {
    const discoverAdvertisedDiscounts = mock(() =>
      Effect.succeed(advertisementQuote)
    );

    const quote = await runWithDiscounts(
      Effect.gen(function* () {
        const pricing = yield* CheckoutPricingService;
        return yield* pricing.quoteAdvertisement({
          reservation,
          locale: "en-US",
        });
      }),
      DiscountServiceMock({ discoverAdvertisedDiscounts })
    );

    expect(discoverAdvertisedDiscounts).toHaveBeenCalledWith({
      product: { kind: "cowork", tier: "basic" },
      discountableSubtotal: money(35_000),
      reservationDate: reservation.date,
      locale: "en-US",
    });
    expect(quote.summary.total).toEqual(money(22_500));
  });

  test("freshly affirms exactly the discounts in the advertisement", async () => {
    const affirmAdvertisement = mock(() =>
      Effect.succeed(affirmedAdvertisement)
    );
    const displayedQuote = await Effect.runPromise(
      calculateWorkspaceCheckoutQuote(reservation, {
        discountQuote: advertisementQuote,
      })
    );

    const result = await runWithDiscounts(
      Effect.gen(function* () {
        const pricing = yield* CheckoutPricingService;
        return yield* pricing.affirmAdvertisement({
          reservation,
          locale: "en-US",
          advertisedQuote: displayedQuote,
        });
      }),
      DiscountServiceMock({ affirmAdvertisement })
    );

    expect(affirmAdvertisement).toHaveBeenCalledWith({
      product: { kind: "cowork", tier: "basic" },
      discountableSubtotal: money(35_000),
      reservationDate: reservation.date,
      locale: "en-US",
      advertisedDiscountIds: [advertisedDiscountId],
    });
    expect(result.discountQuote).toBe(affirmedAdvertisement);
    expect(result.quote.summary.total).toEqual(money(22_500));
  });

  test("completes the affirmed advertisement for the identified customer", async () => {
    const quoteForCustomer = mock(() => Effect.succeed(affirmedAdvertisement));

    const quote = await runWithDiscounts(
      Effect.gen(function* () {
        const pricing = yield* CheckoutPricingService;
        return yield* pricing.quoteForCustomer({
          reservation,
          locale: "en-US",
          dotyposCustomerId: "customer-id",
          affirmedAdvertisement,
        });
      }),
      DiscountServiceMock({ quoteForCustomer })
    );

    expect(quoteForCustomer).toHaveBeenCalledWith({
      affirmedAdvertisement,
      dotyposCustomerId: "customer-id",
      locale: "en-US",
    });
    expect(quote.summary.total).toEqual(money(22_500));
  });

  test("affirms displayed discounts for payment and preserves the commitment", async () => {
    const commitment = { applications: [] } as unknown as DiscountCommitment;
    const affirmForPayment = mock(() =>
      Effect.succeed({ quote: affirmedAdvertisement, commitment })
    );
    const displayedQuote = await Effect.runPromise(
      calculateWorkspaceCheckoutQuote(reservation, {
        discountQuote: advertisementQuote,
      })
    );

    const result = await runWithDiscounts(
      Effect.gen(function* () {
        const pricing = yield* CheckoutPricingService;
        return yield* pricing.affirmForPayment({
          reservation,
          locale: "en-US",
          dotyposCustomerId: "customer-id",
          displayedQuote,
        });
      }),
      DiscountServiceMock({ affirmForPayment })
    );

    expect(affirmForPayment).toHaveBeenCalledWith({
      product: { kind: "cowork", tier: "basic" },
      discountableSubtotal: money(35_000),
      reservationDate: reservation.date,
      dotyposCustomerId: "customer-id",
      locale: "en-US",
      submittedCode: undefined,
      displayedDiscountIds: [advertisedDiscountId],
    });
    expect(result.commitment).toBe(commitment);
    expect(result.quote.summary.total).toEqual(money(22_500));
  });
});
