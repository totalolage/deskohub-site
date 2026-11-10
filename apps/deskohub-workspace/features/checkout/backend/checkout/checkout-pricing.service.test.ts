import "@/shared/polyfills/temporal";
import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { Effect, Layer, Schema } from "effect";
import {
  affirmedDiscountAdvertisementQuoteCodec,
  type DiscountAdvertisementInput,
  discountAdvertisementQuoteCodec,
  discountIdSchema,
} from "@/features/discounts/contracts";
import { DiscountServiceMock } from "@/features/discounts/discount.service.mock";
import { DiscountAffirmationUnavailableError } from "@/features/discounts/errors";
import type { Locale } from "@/features/i18n";
import { getCoworkAdvertisedPriceReservation } from "@/features/reservation/cowork-reservation";
import {
  getMeetingRoomAdvertisedPriceReservation,
  normalizeMeetingRoomReservationOrder,
} from "@/features/reservation/meeting-room-reservation";
import {
  getOfficeAdvertisedPriceReservation,
  officeReservationOrderSchema,
} from "@/features/reservation/office-reservation";
import { getCurrentWorkspaceDate } from "@/features/reservation/reservation-date";
import { TestSealedStateKeys } from "@/shared/testing/sealed-state-keys.test-utils";
import type {
  CheckoutPricingService as CheckoutPricing,
  ICheckoutPricingService,
} from "./checkout-pricing.service";

mock.module("server-only", () => ({}));

const { buildAdvertisedPriceState } = await import("./advertised-price-state");
const { CheckoutPricingService } = await import("./checkout-pricing.service");

const contact = {
  name: "Ada Lovelace",
  email: testEmailAddress("ada"),
  phone: "+420 777 777 777",
};
const bookedAt = Temporal.Instant.from("2099-06-01T10:00:00Z");
const saleId = Schema.decodeUnknownSync(discountIdSchema)("autumn-sale");

type DiscountedProduct = Pick<
  DiscountAdvertisementInput,
  "product" | "discountableSubtotal"
>;

/** Half off the product, as one advertised sale. */
const halfOffSale = ({ product, discountableSubtotal }: DiscountedProduct) => {
  const amount = {
    ...discountableSubtotal,
    value: discountableSubtotal.value / 2,
  };
  const discountedSubtotal = {
    ...discountableSubtotal,
    value: discountableSubtotal.value - amount.value,
  };
  return discountAdvertisementQuoteCodec.make({
    product,
    discountableSubtotal,
    discounts: [
      {
        discount: {
          id: saleId,
          label: "Autumn sale",
          adjustment: { kind: "percentage", basisPoints: 5000 },
        },
        subtotalBefore: discountableSubtotal,
        amount,
        subtotalAfter: discountedSubtotal,
      },
    ],
    totalDiscount: amount,
    discountedSubtotal,
  });
};

const noSale = ({ product, discountableSubtotal }: DiscountedProduct) =>
  discountAdvertisementQuoteCodec.make({
    product,
    discountableSubtotal,
    discounts: [],
    totalDiscount: { ...discountableSubtotal, value: 0 },
    discountedSubtotal: discountableSubtotal,
  });

const run = <A, E>(
  effect: Effect.Effect<A, E, CheckoutPricing>,
  discounts: ReturnType<typeof DiscountServiceMock>
) =>
  effect.pipe(
    Effect.provide(
      Layer.mergeAll(
        CheckoutPricingService.Default.pipe(Layer.provide(discounts)),
        TestSealedStateKeys
      )
    ),
    Effect.runPromise
  );

/** The snapshot a reservation page issues while the sale runs. */
const advertise = (
  input: Parameters<ICheckoutPricingService["quoteAdvertisement"]>[0]
) =>
  CheckoutPricingService.pipe(
    Effect.flatMap((pricing) => pricing.quoteAdvertisement(input)),
    Effect.flatMap((advertised) =>
      buildAdvertisedPriceState({ ...advertised, locale: input.locale })
    ),
    Effect.provide(
      Layer.mergeAll(
        CheckoutPricingService.Default.pipe(
          Layer.provide(
            DiscountServiceMock({
              discoverAdvertisedDiscounts: (discountInput) =>
                Effect.succeed({
                  quote: halfOffSale(discountInput),
                  complete: true,
                }),
            })
          )
        ),
        TestSealedStateKeys
      )
    ),
    Effect.runPromise
  );

const coworkOrder = {
  kind: "cowork" as const,
  entryTier: "basic" as const,
  coffee: true,
  date: "2099-07-30",
  ...contact,
};

const meetingRoomOrder = await normalizeMeetingRoomReservationOrder({
  kind: "meeting-room",
  duration: { unit: "hour", amount: 4 },
  reservationDate: "2099-06-10",
  startsAt: "2099-06-10T10:00",
  endsAt: "2099-06-10T14:00",
  ...contact,
}).pipe(Effect.runPromise);

const officeStartsOn = getCurrentWorkspaceDate().add({ days: 1 });
const officeOrder = Schema.decodeUnknownSync(
  officeReservationOrderSchema("CZ")
)({
  kind: "office",
  startsOn: officeStartsOn.toString(),
  endsOn: officeStartsOn.add({ days: 1 }).toString(),
  seats: 3,
  ...contact,
});

const families = [
  {
    kind: "cowork",
    order: coworkOrder,
    /** The same family with an input that changes the price. */
    otherOrder: { ...coworkOrder, coffee: false },
    advertise: (locale: Locale) =>
      advertise({
        reservation: getCoworkAdvertisedPriceReservation(coworkOrder),
        locale,
      }),
    changedKeys: {
      sectionKeys: ["order", "total"],
      itemKeys: ["product:cowork:basic", "total:final"],
    },
  },
  {
    kind: "meeting-room",
    order: meetingRoomOrder,
    otherOrder: {
      ...meetingRoomOrder,
      duration: { unit: "hour", amount: 1 },
    },
    advertise: (locale: Locale) =>
      advertise({
        reservation: getMeetingRoomAdvertisedPriceReservation(meetingRoomOrder),
        locale,
      }),
    changedKeys: {
      sectionKeys: ["order", "total"],
      itemKeys: ["product:meeting-room:hour:4", "total:final"],
    },
  },
  {
    kind: "office",
    order: officeOrder,
    otherOrder: { ...officeOrder, seats: 4 },
    advertise: (locale: Locale) =>
      advertise({
        reservation: getOfficeAdvertisedPriceReservation(officeOrder),
        locale,
      }),
    changedKeys: {
      sectionKeys: ["order", "total"],
      itemKeys: ["product:office:3:2", "total:final"],
    },
  },
] as const;

describe("CheckoutPricingService.affirmAdvertisement", () => {
  describe.each(families)("$kind", (family) => {
    const affirm = async (input: {
      readonly reservation?: (typeof families)[number]["order"];
      readonly advertisedIn?: Locale;
      readonly affirmAdvertisement: Parameters<
        typeof DiscountServiceMock
      >[0]["affirmAdvertisement"];
    }) => {
      const advertisement = await family.advertise(
        input.advertisedIn ?? "en-US"
      );
      const affirmAdvertisement = mock(input.affirmAdvertisement);
      const result = await run(
        CheckoutPricingService.pipe(
          Effect.flatMap((pricing) =>
            pricing.affirmAdvertisement({
              advertisement,
              reservation: input.reservation ?? family.order,
              locale: "en-US",
              bookedAt,
            })
          ),
          Effect.result
        ),
        DiscountServiceMock({ affirmAdvertisement })
      );
      return { advertisement, affirmAdvertisement, result };
    };

    test("affirms the advertised price while its discounts still apply", async () => {
      const { advertisement, affirmAdvertisement, result } = await affirm({
        affirmAdvertisement: (discountInput) =>
          Effect.succeed(
            affirmedDiscountAdvertisementQuoteCodec.make(
              halfOffSale(discountInput)
            )
          ),
      });

      expect(affirmAdvertisement).toHaveBeenCalledWith(
        expect.objectContaining({
          bookedAt,
          locale: "en-US",
          advertisedDiscountIds: [saleId],
        })
      );
      expect(result).toMatchObject({
        _tag: "Success",
        success: {
          status: "affirmed",
          priced: {
            kind: family.kind,
            reservation: family.order,
            advertisedQuote: advertisement.quote,
            discountQuote: { discounts: [{ discount: { id: saleId } }] },
          },
        },
      });
      expect(result).not.toHaveProperty("success.changedKeys");
    });

    test("names the changed summary keys when an advertised discount is gone", async () => {
      const { advertisement, result } = await affirm({
        affirmAdvertisement: (discountInput) =>
          Effect.succeed(
            affirmedDiscountAdvertisementQuoteCodec.make(noSale(discountInput))
          ),
      });

      expect(result).toMatchObject({
        _tag: "Success",
        success: {
          status: "pricing_changed",
          priced: {
            kind: family.kind,
            reservation: family.order,
            advertisedQuote: advertisement.quote,
            discountQuote: { discounts: [] },
          },
          changedKeys: family.changedKeys,
        },
      });
    });

    test("rejects a snapshot of another locale or reservation before pricing", async () => {
      for (const mismatch of [
        { advertisedIn: "cs-CZ" as const },
        { reservation: family.otherOrder },
      ]) {
        const { affirmAdvertisement, result } = await affirm({
          ...mismatch,
          affirmAdvertisement: () => Effect.die("must not affirm"),
        });

        expect(result).toMatchObject({
          _tag: "Failure",
          failure: {
            _tag: "AdvertisedPriceMismatchError",
            reason: "input_mismatch",
          },
        });
        expect(affirmAdvertisement).not.toHaveBeenCalled();
      }
    });

    test("keeps an unknown discount a retryable failure, never a changed price", async () => {
      const { result } = await affirm({
        affirmAdvertisement: () =>
          Effect.fail(
            new DiscountAffirmationUnavailableError({
              message: "The sale could not be affirmed.",
              discountIds: [saleId],
            })
          ),
      });

      expect(result).toMatchObject({
        _tag: "Failure",
        failure: {
          _tag: "DiscountAffirmationUnavailableError",
          discountIds: [saleId],
        },
      });
    });
  });

  test("rejects a snapshot of another reservation family before pricing", async () => {
    const advertisement = await families[0].advertise("en-US");
    const affirmAdvertisement = mock(() => Effect.die("must not affirm"));

    const result = await run(
      CheckoutPricingService.pipe(
        Effect.flatMap((pricing) =>
          pricing.affirmAdvertisement({
            advertisement,
            reservation: officeOrder,
            locale: "en-US",
            bookedAt,
          })
        ),
        Effect.result
      ),
      DiscountServiceMock({ affirmAdvertisement })
    );

    expect(result).toMatchObject({
      _tag: "Failure",
      failure: {
        _tag: "AdvertisedPriceMismatchError",
        reason: "input_mismatch",
      },
    });
    expect(affirmAdvertisement).not.toHaveBeenCalled();
  });
});
