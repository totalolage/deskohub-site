import "@/shared/testing/workspace-test-env";
import { describe, expect, mock, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { Effect, Schema } from "effect";
import { buildCoworkReservationQuote } from "@/features/checkout/reservation-quote-cowork";
import { makeDiscountCommitment } from "@/features/discounts/commitment";
import {
  affirmedDiscountAdvertisementQuoteCodec,
  canonicalPromotionCodeSchema,
  discountAdvertisementQuoteCodec,
  discountIdSchema,
  discountQuoteCodec,
} from "@/features/discounts/contracts";
import type { DiscountService } from "@/features/discounts/discount.service";
import { DiscountServiceMock } from "@/features/discounts/discount.service.mock";
import {
  DiscountProviderError,
  PromotionCodeUnavailableError,
} from "@/features/discounts/errors";
import { getCoworkAdvertisedPriceReservation } from "@/features/reservation/cowork-reservation";
import { dotyposCustomerIdSchema } from "@/features/reservation/dotypos-customer";
import type { Money } from "@/shared/money/money";
import { coworkCheckoutPricing } from "./cowork-checkout-pricing";

const testEmailAddressForAda = testEmailAddress("ada");

const money = (value: number): Money => ({
  value,
  exponent: 2,
  currency: "CZK",
});

const advertisedDiscountId =
  Schema.decodeUnknownSync(discountIdSchema)("summer-sale");
const dotyposCustomerId = Schema.decodeUnknownSync(dotyposCustomerIdSchema)(
  "customer-id"
);
const submittedCode = Schema.decodeUnknownSync(canonicalPromotionCodeSchema)(
  "SAVE20"
);
const emptyCommitment = () =>
  makeDiscountCommitment({
    product: { kind: "cowork", tier: "basic" },
    applications: [],
  });

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
  email: testEmailAddressForAda,
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

const bookedAt = Temporal.Instant.from("2099-06-01T10:00:00Z");

describe("cowork checkout pricing", () => {
  test("quotes the advertised catalog price with anonymous discounts", async () => {
    const discoverAdvertisedDiscounts = mock(() =>
      Effect.succeed({ quote: advertisementQuote, complete: true })
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
    const expectedQuote = await Effect.runPromise(
      buildCoworkReservationQuote(advertisedReservation.details, {
        discountQuote: advertisementQuote,
      })
    );

    expect(discoverAdvertisedDiscounts).toHaveBeenCalledWith({
      product: { kind: "cowork", tier: "basic" },
      discountableSubtotal: money(35_000),
      lastServiceDate: reservation.date,
      locale: "en-US",
      bookedAt: expect.any(Temporal.Instant),
    });
    expect(result.kind).toBe("cowork");
    expect(result.reservation).toBe(advertisedReservation);
    expect(result.quote).toEqual(expectedQuote);
    expect(result.discountsComplete).toBeTrue();
    expect(result.quote.payment.expectedPrice).toEqual(money(22_500));
  });

  test("previews a submitted query code in the advertised quote", async () => {
    const baseQuote = discountAdvertisementQuoteCodec.make({
      product: { kind: "cowork", tier: "basic" },
      discountableSubtotal: money(35_000),
      discounts: [],
      totalDiscount: money(0),
      discountedSubtotal: money(35_000),
    });
    const codeDiscountId = Schema.decodeUnknownSync(discountIdSchema)("code");
    const application = {
      discount: {
        id: codeDiscountId,
        label: "Campaign code",
        adjustment: { kind: "percentage" as const, basisPoints: 2000 },
      },
      subtotalBefore: money(35_000),
      amount: money(7000),
      subtotalAfter: money(28_000),
    };
    const previewDiscountCode = mock(() =>
      Effect.succeed({
        application,
        quote: discountQuoteCodec.make({
          ...baseQuote,
          discounts: [application],
          totalDiscount: money(7000),
          discountedSubtotal: money(28_000),
        }),
      })
    );

    const result = await runWithDiscounts(
      Effect.gen(function* () {
        const pricing = yield* coworkCheckoutPricing;
        return yield* pricing.quoteAdvertisement({
          reservation: advertisedReservation,
          locale: "en-US",
          submittedCode,
        });
      }),
      DiscountServiceMock({
        discoverAdvertisedDiscounts: () =>
          Effect.succeed({ quote: baseQuote, complete: true }),
        previewDiscountCode,
      })
    );

    expect(previewDiscountCode).toHaveBeenCalledWith({
      baseQuote,
      locale: "en-US",
      submittedCode,
    });
    expect(result).toMatchObject({
      submittedCode,
      submittedCodeDiscountId: codeDiscountId,
      quote: { payment: { expectedPrice: money(33_000) } },
    });
  });

  test("freshly affirms exactly the discounts in the advertisement", async () => {
    const affirmAdvertisement = mock(() =>
      Effect.succeed(affirmedAdvertisement)
    );
    const displayedQuote = await Effect.runPromise(
      buildCoworkReservationQuote(reservation, {
        discountQuote: advertisementQuote,
      })
    );

    const result = await runWithDiscounts(
      Effect.gen(function* () {
        const pricing = yield* coworkCheckoutPricing;
        return yield* pricing.affirmAdvertisement({
          reservation: advertisedReservation,
          locale: "en-US",
          bookedAt,
          advertisedQuote: displayedQuote,
        });
      }),
      DiscountServiceMock({ affirmAdvertisement })
    );

    expect(affirmAdvertisement).toHaveBeenCalledWith({
      product: { kind: "cowork", tier: "basic" },
      discountableSubtotal: money(35_000),
      lastServiceDate: reservation.date,
      locale: "en-US",
      bookedAt,
      advertisedDiscountIds: [advertisedDiscountId],
    });
    expect(result.discountQuote).toBe(affirmedAdvertisement);
    expect(result.quote.payment.expectedPrice).toEqual(money(22_500));
  });

  describe("affirming an advertised query code", () => {
    const codeDiscountId = Schema.decodeUnknownSync(discountIdSchema)("code");
    const codeApplication = {
      discount: {
        id: codeDiscountId,
        label: "Campaign code",
        adjustment: { kind: "percentage" as const, basisPoints: 2000 },
      },
      subtotalBefore: money(17_500),
      amount: money(3500),
      subtotalAfter: money(14_000),
    };

    /** Affirms an advertisement carrying the code while code preview fails. */
    const affirmWithFailedCodePreview = async (
      failure: DiscountProviderError | PromotionCodeUnavailableError
    ) => {
      const advertisedQuote = await Effect.runPromise(
        buildCoworkReservationQuote(reservation, {
          discountQuote: discountQuoteCodec.make({
            ...advertisementQuote,
            discounts: [...advertisementQuote.discounts, codeApplication],
            totalDiscount: money(21_000),
            discountedSubtotal: money(14_000),
          }),
        })
      );
      const affirmAdvertisement = mock(() =>
        Effect.succeed(affirmedAdvertisement)
      );

      const result = await runWithDiscounts(
        Effect.gen(function* () {
          const pricing = yield* coworkCheckoutPricing;
          return yield* pricing
            .affirmAdvertisement({
              reservation: advertisedReservation,
              locale: "en-US",
              bookedAt,
              advertisedQuote,
              submittedCode,
              submittedCodeDiscountId: codeDiscountId,
            })
            .pipe(Effect.result);
        }),
        DiscountServiceMock({
          affirmAdvertisement,
          previewDiscountCode: () => Effect.fail(failure),
        })
      );

      return { advertisedQuote, affirmAdvertisement, result };
    };

    test("fails instead of dropping a code whose provider is unavailable", async () => {
      const { affirmAdvertisement, result } = await affirmWithFailedCodePreview(
        new DiscountProviderError({
          reason: "provider_failure",
          message: "Promotion codes could not be loaded.",
        })
      );

      expect(affirmAdvertisement).toHaveBeenCalledWith(
        expect.objectContaining({
          advertisedDiscountIds: [advertisedDiscountId],
        })
      );
      expect(result).toMatchObject({
        _tag: "Failure",
        failure: {
          _tag: "DiscountAffirmationUnavailableError",
          discountIds: [codeDiscountId],
        },
      });
    });

    test("drops a code that is no longer available", async () => {
      const { advertisedQuote, result } = await affirmWithFailedCodePreview(
        new PromotionCodeUnavailableError({
          reason: "usage_limit_reached",
          message: "The code has no uses left.",
        })
      );

      expect(result._tag).toBe("Success");
      if (result._tag !== "Success") return;
      expect(result.success.submittedCodeDiscountId).toBeUndefined();
      expect(result.success.quote.fingerprint).not.toBe(
        advertisedQuote.fingerprint
      );
      expect(result.success.quote.payment.expectedPrice).toEqual(money(22_500));
    });

    test("omits a code from discovery when its provider is unavailable", async () => {
      const result = await runWithDiscounts(
        Effect.gen(function* () {
          const pricing = yield* coworkCheckoutPricing;
          return yield* pricing.quoteAdvertisement({
            reservation: advertisedReservation,
            locale: "en-US",
            submittedCode,
          });
        }),
        DiscountServiceMock({
          discoverAdvertisedDiscounts: () =>
            Effect.succeed({ quote: advertisementQuote, complete: true }),
          previewDiscountCode: () =>
            Effect.fail(
              new DiscountProviderError({
                reason: "provider_failure",
                message: "Promotion codes could not be loaded.",
              })
            ),
        })
      );

      expect(result.submittedCodeDiscountId).toBeUndefined();
      expect(result.quote.payment.expectedPrice).toEqual(money(22_500));
    });
  });

  test("affirms the displayed price before appending a submitted code", async () => {
    const commitment = emptyCommitment();
    const affirmDisplayedDiscounts = mock(() =>
      Effect.succeed({ quote: affirmedAdvertisement, commitment })
    );
    const codeDiscountId = Schema.decodeUnknownSync(discountIdSchema)("code");
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
          subtotalBefore: money(17_500),
          amount: money(3500),
          subtotalAfter: money(14_000),
        },
      ],
      totalDiscount: money(21_000),
      discountedSubtotal: money(14_000),
    });
    const codeApplication = codeQuote.discounts.at(-1);
    if (!codeApplication) throw new Error("Expected code application");
    const applyDiscountCode = mock(() =>
      Effect.succeed({ quote: codeQuote, application: codeApplication })
    );
    const displayedQuote = await Effect.runPromise(
      buildCoworkReservationQuote(reservation, {
        discountQuote: advertisementQuote,
      })
    );

    const result = await runWithDiscounts(
      Effect.gen(function* () {
        const pricing = yield* coworkCheckoutPricing;
        return yield* pricing.applyDiscountCode({
          reservation,
          locale: "en-US",
          bookedAt,
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
      product: { kind: "cowork", tier: "basic" },
      discountableSubtotal: money(35_000),
      lastServiceDate: reservation.date,
      dotyposCustomerId,
      locale: "en-US",
      bookedAt,
      submittedCode: undefined,
      displayedDiscountIds: [advertisedDiscountId],
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
      quote: { payment: { expectedPrice: money(19_000) } },
    });
  });

  test("returns pricing_changed before resolving a submitted code", async () => {
    const commitment = emptyCommitment();
    const affirmDisplayedDiscounts = mock(() =>
      Effect.succeed({
        quote: discountQuoteCodec.make({
          product: { kind: "cowork", tier: "basic" },
          discountableSubtotal: money(35_000),
          discounts: [],
          totalDiscount: money(0),
          discountedSubtotal: money(35_000),
        }),
        commitment,
      })
    );
    const applyDiscountCode = mock(() => Effect.die("must not resolve code"));
    const displayedQuote = await Effect.runPromise(
      buildCoworkReservationQuote(reservation, {
        discountQuote: advertisementQuote,
      })
    );

    const result = await runWithDiscounts(
      Effect.gen(function* () {
        const pricing = yield* coworkCheckoutPricing;
        return yield* pricing.applyDiscountCode({
          reservation,
          locale: "en-US",
          bookedAt,
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
        itemKeys: ["product:cowork:basic", "total:final"],
        sectionKeys: ["order", "total"],
      },
    });
    expect(applyDiscountCode).not.toHaveBeenCalled();
  });

  test("keeps a historical profi full order pricable through quote and payment", async () => {
    const profiOrder = {
      kind: "cowork" as const,
      entryTier: "profi" as const,
      coffee: true,
      monitorOption: "2x27-qhd" as const,
      date: "2099-07-30",
      name: "Ada Lovelace",
      email: testEmailAddressForAda,
      phone: "+420 777 777 777",
    };
    const profiQuote = discountQuoteCodec.make({
      product: { kind: "cowork", tier: "profi" },
      discountableSubtotal: money(55_000),
      discounts: [],
      totalDiscount: money(0),
      discountedSubtotal: money(55_000),
    });
    const profiAffirmedAdvertisement =
      affirmedDiscountAdvertisementQuoteCodec.make(profiQuote);
    const commitment = makeDiscountCommitment({
      product: { kind: "cowork", tier: "profi" },
      applications: [],
    });
    const applyCustomerDiscount = mock(() => Effect.succeed(profiQuote));
    const affirmDisplayedDiscounts = mock(() =>
      Effect.succeed({ quote: profiAffirmedAdvertisement, commitment })
    );
    const expectedQuote = await Effect.runPromise(
      buildCoworkReservationQuote(profiOrder, { discountQuote: profiQuote })
    );

    const customerQuote = await runWithDiscounts(
      Effect.gen(function* () {
        const pricing = yield* coworkCheckoutPricing;
        return yield* pricing.quoteForCustomer({
          reservation: profiOrder,
          locale: "en-US",
          dotyposCustomerId,
          affirmedAdvertisement: profiAffirmedAdvertisement,
        });
      }),
      DiscountServiceMock({ applyCustomerDiscount })
    );

    expect(applyCustomerDiscount).toHaveBeenCalledWith({
      affirmedAdvertisement: profiAffirmedAdvertisement,
      dotyposCustomerId,
      locale: "en-US",
    });
    expect(customerQuote.reservation).toBe(profiOrder);
    expect(customerQuote.quote).toEqual(expectedQuote);
    expect(customerQuote.quote.items).toEqual([
      { type: "cowork", tier: "profi", amount: money(55_000) },
      { type: "coffee", amount: money(0) },
    ]);
    expect(customerQuote.quote.payment.expectedPrice).toEqual(money(55_000));

    const payment = await runWithDiscounts(
      Effect.gen(function* () {
        const pricing = yield* coworkCheckoutPricing;
        return yield* pricing.affirmForPayment({
          reservation: profiOrder,
          locale: "en-US",
          bookedAt,
          dotyposCustomerId,
          quote: customerQuote.quote,
        });
      }),
      DiscountServiceMock({ affirmDisplayedDiscounts })
    );

    expect(affirmDisplayedDiscounts).toHaveBeenCalledWith({
      product: { kind: "cowork", tier: "profi" },
      discountableSubtotal: money(55_000),
      lastServiceDate: profiOrder.date,
      dotyposCustomerId,
      locale: "en-US",
      bookedAt,
      submittedCode: undefined,
      displayedDiscountIds: [],
    });
    expect(payment.reservation).toBe(profiOrder);
    expect(payment.commitment).toBe(commitment);
    expect(payment.quote.fingerprint).toBe(customerQuote.quote.fingerprint);
    expect(payment.quote.payment.expectedPrice).toEqual(money(55_000));
  });

  test("prices workstation presence from the advertised reserved-desk selection", async () => {
    const reservedDeskQuote = discountAdvertisementQuoteCodec.make({
      product: { kind: "cowork", tier: "reserved-desk" },
      discountableSubtotal: money(41_000),
      discounts: [],
      totalDiscount: money(0),
      discountedSubtotal: money(41_000),
    });
    const discoverAdvertisedDiscounts = mock(() =>
      Effect.succeed({ quote: reservedDeskQuote, complete: true })
    );
    const withMonitor = getCoworkAdvertisedPriceReservation({
      entryTier: "reserved-desk",
      coffee: true,
      date: "2099-07-30",
      monitorOption: "2x27-qhd",
    });
    const withOtherMonitor = getCoworkAdvertisedPriceReservation({
      entryTier: "reserved-desk",
      coffee: true,
      date: "2099-07-30",
      monitorOption: "2x32-4k",
    });
    const withoutMonitor = getCoworkAdvertisedPriceReservation({
      entryTier: "reserved-desk",
      coffee: true,
      date: "2099-07-30",
    });

    expect(withMonitor.details).toMatchObject({ workstation: true });
    expect(withoutMonitor.details).toMatchObject({ workstation: false });

    const quoteFor = (advertised: typeof withMonitor) =>
      runWithDiscounts(
        Effect.gen(function* () {
          const pricing = yield* coworkCheckoutPricing;
          return yield* pricing.quoteAdvertisement({
            reservation: advertised,
            locale: "en-US",
          });
        }),
        DiscountServiceMock({ discoverAdvertisedDiscounts })
      );

    const withWorkstation = await quoteFor(withMonitor);
    const withoutWorkstation = await quoteFor(withoutMonitor);
    const withOtherWorkstation = await quoteFor(withOtherMonitor);

    expect(discoverAdvertisedDiscounts).toHaveBeenCalledWith({
      product: { kind: "cowork", tier: "reserved-desk" },
      discountableSubtotal: money(41_000),
      lastServiceDate: "2099-07-30",
      locale: "en-US",
      bookedAt: expect.any(Temporal.Instant),
    });
    expect(withWorkstation.quote.items).toEqual([
      { type: "cowork", tier: "reserved-desk", amount: money(41_000) },
      { type: "workstation", amount: money(12_000) },
    ]);
    expect(withWorkstation.quote.payment.expectedPrice).toEqual(money(53_000));
    expect(withoutWorkstation.quote.items).toEqual([
      { type: "cowork", tier: "reserved-desk", amount: money(41_000) },
    ]);
    expect(withoutWorkstation.quote.payment.expectedPrice).toEqual(
      money(41_000)
    );
    // The chosen monitor model never changes the advertised quote or its
    // fingerprint; only workstation presence prices the add-on.
    expect(withOtherWorkstation.quote).toEqual(withWorkstation.quote);
  });
});
