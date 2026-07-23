import "@/shared/polyfills/temporal";
import "@/shared/testing/workspace-test-env";
import { describe, expect, mock, test } from "bun:test";
import { Effect, Schema } from "effect";
import { getWorkspaceMeetingRoomPriceForDuration } from "@/features/checkout/product-catalog";
import type { DiscountCommitment } from "@/features/discounts";
import {
  affirmedDiscountAdvertisementQuoteCodec,
  discountAdvertisementQuoteCodec,
  discountIdSchema,
} from "@/features/discounts/contracts";
import type { DiscountService } from "@/features/discounts/discount.service";
import { DiscountServiceMock } from "@/features/discounts/discount.service.mock";
import { dotyposCustomerIdSchema } from "@/features/reservation/dotypos-customer";
import { normalizeMeetingRoomReservationOrder } from "@/features/reservation/meeting-room-reservation";
import { meetingRoomCheckoutPricing } from "./meeting-room-checkout-pricing";

const money = getWorkspaceMeetingRoomPriceForDuration(240);
const discountId = Schema.decodeUnknownSync(discountIdSchema)("summer-sale");
const dotyposCustomerId = Schema.decodeUnknownSync(dotyposCustomerIdSchema)(
  "customer-id"
);

const advertisementQuote = discountAdvertisementQuoteCodec.make({
  product: { kind: "meeting-room", durationMinutes: 240 },
  discountableSubtotal: money,
  discounts: [
    {
      discount: {
        id: discountId,
        label: "Summer sale",
        adjustment: { kind: "percentage", basisPoints: 5000 },
      },
      subtotalBefore: money,
      amount: { ...money, value: money.value / 2 },
      subtotalAfter: { ...money, value: money.value / 2 },
    },
  ],
  totalDiscount: { ...money, value: money.value / 2 },
  discountedSubtotal: { ...money, value: money.value / 2 },
});
const affirmedAdvertisement =
  affirmedDiscountAdvertisementQuoteCodec.make(advertisementQuote);

const reservation = await normalizeMeetingRoomReservationOrder({
  kind: "meeting-room",
  startsAt: "2099-06-10T10:00",
  endsAt: "2099-06-10T14:00",
  name: "Ada Lovelace",
  email: "ada@example.com",
  phone: "+420 777 777 777",
}).pipe(Effect.runPromise);
const advertisedReservation = {
  kind: "meeting-room" as const,
  details: {
    kind: reservation.kind,
    startsAt: reservation.startsAt,
    endsAt: reservation.endsAt,
  },
};

const runWithDiscounts = <A, E>(
  effect: Effect.Effect<A, E, DiscountService>,
  discounts: ReturnType<typeof DiscountServiceMock>
) => effect.pipe(Effect.provide(discounts), Effect.runPromise);

describe("meeting-room checkout pricing", () => {
  test("quotes anonymous discounts from the family product and Prague date", async () => {
    const discoverAdvertisedDiscounts = mock(() =>
      Effect.succeed(advertisementQuote)
    );

    const result = await runWithDiscounts(
      Effect.gen(function* () {
        const pricing = yield* meetingRoomCheckoutPricing;
        return yield* pricing.quoteAdvertisement({
          reservation: advertisedReservation,
          locale: "en-US",
        });
      }),
      DiscountServiceMock({ discoverAdvertisedDiscounts })
    );

    expect(discoverAdvertisedDiscounts).toHaveBeenCalledWith({
      product: { kind: "meeting-room", durationMinutes: 240 },
      discountableSubtotal: money,
      reservationDate: "2099-06-10",
      locale: "en-US",
    });
    expect(result.quote.payment.expectedPrice).toEqual(
      advertisementQuote.discountedSubtotal
    );
    expect(result.quote.fingerprint).not.toBeEmpty();
  });

  test("freshly affirms only the advertised anonymous discounts", async () => {
    const affirmAdvertisement = mock(() =>
      Effect.succeed(affirmedAdvertisement)
    );
    const advertised = await runWithDiscounts(
      Effect.gen(function* () {
        const pricing = yield* meetingRoomCheckoutPricing;
        return yield* pricing.quoteAdvertisement({
          reservation: advertisedReservation,
          locale: "en-US",
        });
      }),
      DiscountServiceMock({
        discoverAdvertisedDiscounts: () => Effect.succeed(advertisementQuote),
      })
    );

    const result = await runWithDiscounts(
      Effect.gen(function* () {
        const pricing = yield* meetingRoomCheckoutPricing;
        return yield* pricing.affirmAdvertisement({
          reservation: advertisedReservation,
          locale: "en-US",
          advertisedQuote: advertised.quote,
        });
      }),
      DiscountServiceMock({ affirmAdvertisement })
    );

    expect(affirmAdvertisement).toHaveBeenCalledWith({
      product: { kind: "meeting-room", durationMinutes: 240 },
      discountableSubtotal: money,
      reservationDate: "2099-06-10",
      locale: "en-US",
      advertisedDiscountIds: [discountId],
    });
    expect(result.discountQuote).toBe(affirmedAdvertisement);
  });

  test("adds customer pricing only to the affirmed advertisement", async () => {
    const applyCustomerDiscount = mock(() =>
      Effect.succeed(affirmedAdvertisement)
    );

    const result = await runWithDiscounts(
      Effect.gen(function* () {
        const pricing = yield* meetingRoomCheckoutPricing;
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
    expect(result.quote.payment.discounts).toEqual(
      affirmedAdvertisement.discounts
    );
  });

  test("affirms the displayed payment discounts and preserves commitment", async () => {
    const commitment = { applications: [] } as unknown as DiscountCommitment;
    const affirmForPayment = mock(() =>
      Effect.succeed({ quote: affirmedAdvertisement, commitment })
    );
    const advertised = await runWithDiscounts(
      Effect.gen(function* () {
        const pricing = yield* meetingRoomCheckoutPricing;
        return yield* pricing.quoteAdvertisement({
          reservation: advertisedReservation,
          locale: "en-US",
        });
      }),
      DiscountServiceMock({
        discoverAdvertisedDiscounts: () => Effect.succeed(advertisementQuote),
      })
    );

    const result = await runWithDiscounts(
      Effect.gen(function* () {
        const pricing = yield* meetingRoomCheckoutPricing;
        return yield* pricing.affirmForPayment({
          reservation,
          locale: "en-US",
          dotyposCustomerId,
          quote: advertised.quote,
        });
      }),
      DiscountServiceMock({ affirmForPayment })
    );

    expect(affirmForPayment).toHaveBeenCalledWith({
      product: { kind: "meeting-room", durationMinutes: 240 },
      discountableSubtotal: money,
      reservationDate: "2099-06-10",
      dotyposCustomerId,
      locale: "en-US",
      submittedCode: undefined,
      displayedDiscountIds: [discountId],
    });
    expect(result.commitment).toBe(commitment);
  });
});
