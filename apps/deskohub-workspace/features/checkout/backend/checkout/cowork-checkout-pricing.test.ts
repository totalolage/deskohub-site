import "@/shared/testing/workspace-test-env";
import { describe, expect, mock, test } from "bun:test";
import { Effect, Schema } from "effect";
import { calculateCoworkReservationQuote } from "@/features/checkout/checkout-quote";
import type { WorkspaceMoney } from "@/features/checkout/workspace-money";
import type { DiscountCommitment } from "@/features/discounts";
import {
  affirmedDiscountAdvertisementQuoteCodec,
  discountAdvertisementQuoteCodec,
  discountIdSchema,
} from "@/features/discounts/contracts";
import type { DiscountService } from "@/features/discounts/discount.service";
import { DiscountServiceMock } from "@/features/discounts/discount.service.mock";
import { dotyposCustomerIdSchema } from "@/features/reservation/dotypos-customer";
import { coworkCheckoutPricing } from "./cowork-checkout-pricing";

const money = (value: number): WorkspaceMoney => ({
  value,
  exponent: 2,
  currency: "CZK",
});

const advertisedDiscountId =
  Schema.decodeUnknownSync(discountIdSchema)("summer-sale");
const dotyposCustomerId = Schema.decodeUnknownSync(dotyposCustomerIdSchema)(
  "customer-id"
);

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
  kind: "cowork" as const,
  entryTier: "basic" as const,
  coffee: true,
  date: "2099-07-30",
  name: "Ada Lovelace",
  email: "ada@example.com",
  phone: "+420 777 777 777",
};

const advertisedReservation = {
  kind: "cowork" as const,
  details: {
    kind: reservation.kind,
    entryTier: reservation.entryTier,
    coffee: reservation.coffee,
    date: reservation.date,
  },
};

const runWithDiscounts = <A, E>(
  effect: Effect.Effect<A, E, DiscountService>,
  discounts: ReturnType<typeof DiscountServiceMock>
) => effect.pipe(Effect.provide(discounts), Effect.runPromise);

describe("cowork checkout pricing", () => {
  test("quotes the advertised catalog price with anonymous discounts", async () => {
    const discoverAdvertisedDiscounts = mock(() =>
      Effect.succeed(advertisementQuote)
    );

    const result = await runWithDiscounts(
      Effect.gen(function* () {
        const pricing = yield* coworkCheckoutPricing;
        return yield* pricing.quoteAdvertisement({
          reservation: advertisedReservation,
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
    expect(result.quote.summary.total).toEqual(money(22_500));
  });

  test("freshly affirms exactly the discounts in the advertisement", async () => {
    const affirmAdvertisement = mock(() =>
      Effect.succeed(affirmedAdvertisement)
    );
    const displayedQuote = await Effect.runPromise(
      calculateCoworkReservationQuote(reservation, {
        discountQuote: advertisementQuote,
      })
    );

    const result = await runWithDiscounts(
      Effect.gen(function* () {
        const pricing = yield* coworkCheckoutPricing;
        return yield* pricing.affirmAdvertisement({
          reservation: advertisedReservation,
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

  test("applies customer discounts to the affirmed advertisement", async () => {
    const applyCustomerDiscount = mock(() =>
      Effect.succeed(affirmedAdvertisement)
    );

    const result = await runWithDiscounts(
      Effect.gen(function* () {
        const pricing = yield* coworkCheckoutPricing;
        return yield* pricing.quoteForCustomer({
          reservation,
          locale: "en-US",
          dotyposCustomerId,
          affirmedAdvertisement,
        });
      }),
      DiscountServiceMock({ applyCustomerDiscount })
    );

    expect(applyCustomerDiscount).toHaveBeenCalledWith({
      affirmedAdvertisement,
      dotyposCustomerId,
      locale: "en-US",
    });
    expect(result.quote.summary.total).toEqual(money(22_500));
  });

  test("affirms displayed discounts for payment and preserves the commitment", async () => {
    const commitment = { applications: [] } as unknown as DiscountCommitment;
    const affirmForPayment = mock(() =>
      Effect.succeed({ quote: affirmedAdvertisement, commitment })
    );
    const displayedQuote = await Effect.runPromise(
      calculateCoworkReservationQuote(reservation, {
        discountQuote: advertisementQuote,
      })
    );

    const result = await runWithDiscounts(
      Effect.gen(function* () {
        const pricing = yield* coworkCheckoutPricing;
        return yield* pricing.affirmForPayment({
          reservation,
          locale: "en-US",
          dotyposCustomerId,
          quote: displayedQuote,
        });
      }),
      DiscountServiceMock({ affirmForPayment })
    );

    expect(affirmForPayment).toHaveBeenCalledWith({
      product: { kind: "cowork", tier: "basic" },
      discountableSubtotal: money(35_000),
      reservationDate: reservation.date,
      dotyposCustomerId,
      locale: "en-US",
      submittedCode: undefined,
      displayedDiscountIds: [advertisedDiscountId],
    });
    expect(result.commitment).toBe(commitment);
    expect(result.quote.summary.total).toEqual(money(22_500));
  });
});
