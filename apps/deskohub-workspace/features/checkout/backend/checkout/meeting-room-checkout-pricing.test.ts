import "@/shared/polyfills/temporal";
import "@/shared/testing/workspace-test-env";
import { describe, expect, mock, test } from "bun:test";
import { Effect, Schema } from "effect";
import { getWorkspaceMeetingRoomPriceForDuration } from "@/features/checkout/product-catalog";
import { getMeetingRoomReservationQuote } from "@/features/checkout/reservation-quote-meeting-room";
import type { DiscountCommitment } from "@/features/discounts";
import {
  affirmedDiscountAdvertisementQuoteCodec,
  canonicalDiscountCodeSchema,
  discountAdvertisementQuoteCodec,
  discountIdSchema,
  discountQuoteCodec,
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
const submittedCode = Schema.decodeUnknownSync(canonicalDiscountCodeSchema)(
  "SAVE20"
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
    const affirmDisplayedDiscounts = mock(() =>
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
      DiscountServiceMock({ affirmDisplayedDiscounts })
    );

    expect(affirmDisplayedDiscounts).toHaveBeenCalledWith({
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

  test("affirms the displayed price before appending a submitted code", async () => {
    const commitment = { applications: [] } as unknown as DiscountCommitment;
    const affirmDisplayedDiscounts = mock(() =>
      Effect.succeed({ quote: affirmedAdvertisement, commitment })
    );
    const codeDiscountId = Schema.decodeUnknownSync(discountIdSchema)("code");
    const remaining = advertisementQuote.discountedSubtotal.value;
    const codeAmount = Math.round(remaining * 0.2);
    const codeQuote = discountQuoteCodec.make({
      ...affirmedAdvertisement,
      discounts: [
        ...affirmedAdvertisement.discounts,
        {
          discount: {
            id: codeDiscountId,
            label: "Member code",
            adjustment: { kind: "percentage", basisPoints: 2000 },
          },
          subtotalBefore: advertisementQuote.discountedSubtotal,
          amount: { ...money, value: codeAmount },
          subtotalAfter: { ...money, value: remaining - codeAmount },
        },
      ],
      totalDiscount: {
        ...money,
        value: advertisementQuote.totalDiscount.value + codeAmount,
      },
      discountedSubtotal: { ...money, value: remaining - codeAmount },
    });
    const codeApplication = codeQuote.discounts.at(-1);
    if (!codeApplication) throw new Error("Expected code application");
    const applyDiscountCode = mock(() =>
      Effect.succeed({ quote: codeQuote, application: codeApplication })
    );
    const displayedQuoteWithoutFingerprint =
      await getMeetingRoomReservationQuote(reservation, {
        discountQuote: advertisementQuote,
      }).pipe(Effect.runPromise);
    const displayedQuote = await runWithDiscounts(
      Effect.gen(function* () {
        const pricing = yield* meetingRoomCheckoutPricing;
        const advertised = yield* pricing.quoteAdvertisement({
          reservation: advertisedReservation,
          locale: "en-US",
        });
        return advertised.quote;
      }),
      DiscountServiceMock({
        discoverAdvertisedDiscounts: () => Effect.succeed(advertisementQuote),
      })
    );

    expect(displayedQuote.payment).toEqual(
      displayedQuoteWithoutFingerprint.payment
    );

    const result = await runWithDiscounts(
      Effect.gen(function* () {
        const pricing = yield* meetingRoomCheckoutPricing;
        return yield* pricing.applyDiscountCode({
          reservation,
          locale: "en-US",
          dotyposCustomerId,
          quote: displayedQuote,
          submittedCode,
        });
      }),
      DiscountServiceMock({
        affirmDisplayedDiscounts,
        applyDiscountCode,
      })
    );

    expect(affirmDisplayedDiscounts).toHaveBeenCalledWith({
      product: { kind: "meeting-room", durationMinutes: 240 },
      discountableSubtotal: money,
      reservationDate: "2099-06-10",
      dotyposCustomerId,
      locale: "en-US",
      submittedCode: undefined,
      displayedDiscountIds: [discountId],
    });
    expect(applyDiscountCode).toHaveBeenCalledWith({
      baseQuote: affirmedAdvertisement,
      dotyposCustomerId,
      locale: "en-US",
      submittedCode,
    });
    expect(result).toMatchObject({
      status: "applied",
      submittedCodeDiscountId: codeApplication.discount.id,
      quote: {
        payment: {
          expectedPrice: codeQuote.discountedSubtotal,
        },
      },
    });
  });

  test("returns pricing_changed before resolving a submitted code", async () => {
    const commitment = { applications: [] } as unknown as DiscountCommitment;
    const affirmedWithoutDiscounts = discountQuoteCodec.make({
      product: { kind: "meeting-room", durationMinutes: 240 },
      discountableSubtotal: money,
      discounts: [],
      totalDiscount: { ...money, value: 0 },
      discountedSubtotal: money,
    });
    const affirmDisplayedDiscounts = mock(() =>
      Effect.succeed({
        quote: affirmedWithoutDiscounts,
        commitment,
      })
    );
    const applyDiscountCode = mock(() => Effect.die("must not resolve code"));
    const displayedQuote = await runWithDiscounts(
      Effect.gen(function* () {
        const pricing = yield* meetingRoomCheckoutPricing;
        const advertised = yield* pricing.quoteAdvertisement({
          reservation: advertisedReservation,
          locale: "en-US",
        });
        return advertised.quote;
      }),
      DiscountServiceMock({
        discoverAdvertisedDiscounts: () => Effect.succeed(advertisementQuote),
      })
    );

    const result = await runWithDiscounts(
      Effect.gen(function* () {
        const pricing = yield* meetingRoomCheckoutPricing;
        return yield* pricing.applyDiscountCode({
          reservation,
          locale: "en-US",
          dotyposCustomerId,
          quote: displayedQuote,
          submittedCode,
        });
      }),
      DiscountServiceMock({
        affirmDisplayedDiscounts,
        applyDiscountCode,
      })
    );

    expect(result).toMatchObject({
      status: "pricing_changed",
      changedKeys: {
        itemKeys: ["product:meeting-room:240", "total:final"],
        sectionKeys: ["order", "total"],
      },
    });
    expect(applyDiscountCode).not.toHaveBeenCalled();
  });
});
