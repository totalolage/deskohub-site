import "@/shared/polyfills/temporal";
import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import { Effect, Schema } from "effect";
import { getWorkspaceOfficePrice } from "@/features/checkout/product-catalog";
import { discountAdvertisementQuoteCodec } from "@/features/discounts/contracts";
import type { DiscountService } from "@/features/discounts/discount.service";
import { DiscountServiceMock } from "@/features/discounts/discount.service.mock";
import {
  getOfficeAdvertisedPriceReservation,
  officeReservationOrderSchema,
} from "@/features/reservation/office-reservation";
import { officeCheckoutPricing } from "./office-checkout-pricing";

const reservation = Schema.decodeUnknownSync(officeReservationOrderSchema)({
  kind: "office",
  startsOn: "2099-06-10",
  endsOn: "2099-06-11",
  seats: 3,
  name: "Ada Lovelace",
  email: "ada@example.com",
  phone: "+420 777 777 777",
});
const advertisedReservation = getOfficeAdvertisedPriceReservation(reservation);
const product = { kind: "office", seats: 3, dayCount: 2 } as const;
const money = getWorkspaceOfficePrice(product);
const advertisementQuote = discountAdvertisementQuoteCodec.make({
  product,
  discountableSubtotal: money,
  discounts: [],
  totalDiscount: { ...money, value: 0 },
  discountedSubtotal: money,
});

const runWithDiscounts = <A, E>(
  effect: Effect.Effect<A, E, DiscountService>,
  discounts: ReturnType<typeof DiscountServiceMock>
) => effect.pipe(Effect.provide(discounts), Effect.runPromise);

describe("office checkout pricing", () => {
  test("quotes with the exact seat and inclusive-day product identity", async () => {
    const discoverAdvertisedDiscounts = mock(() =>
      Effect.succeed(advertisementQuote)
    );

    const result = await runWithDiscounts(
      Effect.gen(function* () {
        const pricing = yield* officeCheckoutPricing;
        return yield* pricing.quoteAdvertisement({
          reservation: advertisedReservation,
          locale: "en-US",
        });
      }),
      DiscountServiceMock({ discoverAdvertisedDiscounts })
    );

    expect(discoverAdvertisedDiscounts).toHaveBeenCalledWith({
      product,
      discountableSubtotal: money,
      reservationDate: "2099-06-10",
      locale: "en-US",
    });
    expect(result.quote.payment.expectedPrice).toEqual(money);
  });
});
