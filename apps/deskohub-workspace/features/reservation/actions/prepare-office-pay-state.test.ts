import "@/shared/polyfills/temporal";
import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { Effect, Layer, Result, Schema } from "effect";
import { CheckoutPricingServiceMock } from "@/features/checkout/backend/checkout/checkout-pricing.service.mock";
import { buildCoworkReservationQuote } from "@/features/checkout/reservation-quote-cowork";
import { buildOfficeReservationQuote } from "@/features/checkout/reservation-quote-office";
import {
  affirmedDiscountAdvertisementQuoteCodec,
  discountIdSchema,
} from "@/features/discounts/contracts";
import {
  getOfficeAdvertisedPriceReservation,
  getOfficeReservationDayCount,
  normalizedOfficeReservationOrderSchema,
} from "@/features/reservation/office-reservation";
import type { Money } from "@/shared/money/money";
import { TestSealedStateKeys } from "@/shared/testing/sealed-state-keys.test-utils";

mock.module("server-only", () => ({}));

const { buildAdvertisedPriceState, sealAdvertisedPriceState } = await import(
  "@/features/checkout/backend/checkout"
);
const { prepareOfficeAdvertisement } = await import(
  "./prepare-office-pay-state"
);

const startsOn = Temporal.Now.plainDateISO("Europe/Prague").add({ days: 10 });
const reservation = Schema.decodeUnknownSync(
  normalizedOfficeReservationOrderSchema
)({
  kind: "office",
  name: "Ada Lovelace",
  email: testEmailAddress("ada"),
  phone: "+420 777 777 777",
  startsOn: startsOn.toString(),
  endsOn: startsOn.add({ days: 1 }).toString(),
  seats: 3,
});
const advertisedReservation = getOfficeAdvertisedPriceReservation(reservation);
const bookedAt = Temporal.Now.instant();

const advertisedQuote = Effect.runSync(
  buildOfficeReservationQuote(advertisedReservation.details)
);

const percentOff = (subtotal: Money, basisPoints: number) => {
  const amount = Math.round((subtotal.value * basisPoints) / 10_000);
  return affirmedDiscountAdvertisementQuoteCodec.make({
    product: {
      kind: "office",
      seats: advertisedReservation.details.seats,
      dayCount: getOfficeReservationDayCount(advertisedReservation.details),
    },
    discountableSubtotal: subtotal,
    discounts: basisPoints
      ? [
          {
            discount: {
              id: Schema.decodeUnknownSync(discountIdSchema)("sale"),
              label: "Sale",
              adjustment: { kind: "percentage", basisPoints },
            },
            subtotalBefore: subtotal,
            amount: { ...subtotal, value: amount },
            subtotalAfter: { ...subtotal, value: subtotal.value - amount },
          },
        ]
      : [],
    totalDiscount: { ...subtotal, value: amount },
    discountedSubtotal: { ...subtotal, value: subtotal.value - amount },
  });
};

const sealToken = (input: {
  readonly locale?: "en-US" | "cs-CZ";
  readonly seats?: 3 | 4;
}) =>
  Effect.gen(function* () {
    const sealedReservation = getOfficeAdvertisedPriceReservation({
      ...reservation,
      seats: input.seats ?? reservation.seats,
    });
    const state = yield* buildAdvertisedPriceState({
      kind: "office",
      locale: input.locale ?? "en-US",
      reservation: sealedReservation,
      quote: yield* buildOfficeReservationQuote(sealedReservation.details),
    });
    return yield* sealAdvertisedPriceState(state);
  }).pipe(Effect.provide(TestSealedStateKeys), Effect.runPromise);

const sealCoworkToken = () =>
  Effect.gen(function* () {
    const details = {
      kind: "cowork" as const,
      entryTier: "open-space" as const,
      coffee: false,
      date: startsOn.toString(),
    };
    const state = yield* buildAdvertisedPriceState({
      kind: "cowork",
      locale: "en-US",
      reservation: { kind: "cowork", details },
      quote: yield* buildCoworkReservationQuote(details),
    });
    return yield* sealAdvertisedPriceState(state);
  }).pipe(Effect.provide(TestSealedStateKeys), Effect.runPromise);

const prepare = async (input: {
  readonly advertisedPriceToken: string;
  readonly basisPoints?: number;
}) => {
  const discountQuote = percentOff(
    advertisedQuote.payment.undiscountedPrice,
    input.basisPoints ?? 0
  );
  const affirmOfficeAdvertisement = mock(() =>
    buildOfficeReservationQuote(advertisedReservation.details, {
      discountQuote,
    }).pipe(
      Effect.map((quote) => ({
        kind: "office" as const,
        reservation: advertisedReservation,
        quote,
        discountQuote,
      }))
    )
  );
  const result = await prepareOfficeAdvertisement({
    locale: "en-US",
    checkoutSessionId: "session-id",
    checkoutAttemptId: "attempt-id",
    advertisedPriceToken: input.advertisedPriceToken,
    reservation,
    bookedAt,
  } as Parameters<typeof prepareOfficeAdvertisement>[0]).pipe(
    Effect.provide(
      Layer.merge(
        CheckoutPricingServiceMock({ affirmOfficeAdvertisement }),
        TestSealedStateKeys
      )
    ),
    Effect.result,
    Effect.runPromise
  );
  return { result, affirmOfficeAdvertisement, discountQuote };
};

describe("prepareOfficeAdvertisement", () => {
  test("affirms the advertised office price and reports no change while it still holds", async () => {
    const advertisedPriceToken = await sealToken({});
    const { result, affirmOfficeAdvertisement, discountQuote } = await prepare({
      advertisedPriceToken,
    });

    expect(affirmOfficeAdvertisement).toHaveBeenCalledWith(
      expect.objectContaining({
        reservation: advertisedReservation,
        locale: "en-US",
        advertisedQuote,
        bookedAt,
      })
    );
    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isSuccess(result)) {
      expect(result.success).toMatchObject({
        kind: "office",
        reservation,
        advertisedQuote,
        discountQuote,
      });
      expect(result.success).not.toHaveProperty("changedKeys");
    }
  });

  test("names the changed summary keys when affirmation reprices the advertisement", async () => {
    const advertisedPriceToken = await sealToken({});
    const { result } = await prepare({
      advertisedPriceToken,
      basisPoints: 1_000,
    });

    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isSuccess(result)) {
      expect(result.success.advertisedQuote).toEqual(advertisedQuote);
      expect(result.success.changedKeys).toBeDefined();
      expect(result.success.changedKeys).not.toEqual({
        sectionKeys: [],
        itemKeys: [],
      });
    }
  });

  test("rejects a snapshot for another product, locale or office reservation before pricing", async () => {
    const tokens = [
      await sealToken({ locale: "cs-CZ" }),
      await sealToken({ seats: 4 }),
      await sealCoworkToken(),
    ];

    for (const advertisedPriceToken of tokens) {
      const { result, affirmOfficeAdvertisement } = await prepare({
        advertisedPriceToken,
      });
      expect(result).toMatchObject({
        _tag: "Failure",
        failure: {
          _tag: "AdvertisedPriceMismatchError",
          reason: "input_mismatch",
        },
      });
      expect(affirmOfficeAdvertisement).not.toHaveBeenCalled();
    }
  });
});
