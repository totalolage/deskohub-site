import "@/shared/polyfills/temporal";
import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { GoogleCalendarAPIError } from "@deskohub/google-calendar";
import { Effect, Layer } from "effect";
import type { AdvertisedPriceRequest } from "@/features/checkout/advertised-price";
import { currencyCZK } from "@/features/checkout/workspace-money";
import { calendarSaleDiscountServiceLayer } from "@/features/discounts/calendar-sale.test-utils";
import { OfficeReservationFeatureFlagService } from "@/features/office/backend/office-reservation-feature-flag.service";
import { AdvisoryAvailabilityInventory } from "@/features/reservation/backend/availability-inventory";
import { getCoworkDateAdvertisedPriceRequests } from "@/features/reservation/cowork-advertised-price";
import { getMeetingRoomDurationAdvertisedPriceRequests } from "@/features/reservation/meeting-room-advertised-price";
import { getOfficeSeatAdvertisedPriceRequests } from "@/features/reservation/office-advertised-price";
import { getCurrentWorkspaceDate } from "@/features/reservation/reservation-date";
import { CheckoutPricingService } from "./checkout-pricing.service";
import { loadPublicOfferings } from "./public-offerings";

const today = getCurrentWorkspaceDate();
const locale = "en-US";

/**
 * Pricing over a real Calendar sale of 20% on every family, with the office
 * open. Only the anonymous discount sources exist: no Dotypos and no
 * customer services are provided.
 */
const saleLayer = (input: {
  readonly calendarId: string;
  readonly firstDay: Temporal.PlainDate;
  readonly lastDay: Temporal.PlainDate;
}) =>
  Layer.mergeAll(
    CheckoutPricingService.Default.pipe(
      Layer.provide(
        calendarSaleDiscountServiceLayer({
          ...input,
          labels: { "en-US": "Sale", "cs-CZ": "Sleva" },
          products: [
            { kind: "cowork" },
            { kind: "meeting-room" },
            { kind: "office" },
          ],
        })
      )
    ),
    Layer.succeed(OfficeReservationFeatureFlagService, {
      isEnabled: Effect.succeed(true),
    }),
    Layer.succeed(AdvisoryAvailabilityInventory, {
      tables: Effect.succeed([]),
      listActiveReservationsOverlapping: () => Effect.succeed([]),
      listLimitations: () => Effect.succeed([]),
    })
  );

/** The requests the reservation pages advertise for a booking today. */
const reservationPageRequests = (): ReadonlyArray<AdvertisedPriceRequest> => {
  const [openSpace, , reservedDesk] = getCoworkDateAdvertisedPriceRequests({
    date: today.toString(),
    locale,
  });

  return [
    openSpace,
    reservedDesk,
    ...getMeetingRoomDurationAdvertisedPriceRequests({
      locale,
      startDateTime: `${today.toString()}T09:00`,
    }),
    ...getOfficeSeatAdvertisedPriceRequests({
      startsOn: today.toString(),
      endsOn: today.toString(),
      seatCapacity: 1,
      locale,
    }),
  ].flatMap((request) => (request ? [request] : []));
};

const loadWithPageParity = (layer: ReturnType<typeof saleLayer>) =>
  Effect.all({
    listing: loadPublicOfferings(locale),
    pagePrices: Effect.forEach(reservationPageRequests(), (request) =>
      CheckoutPricingService.pipe(
        Effect.flatMap((pricing) => pricing.quoteAdvertisement(request)),
        Effect.map(({ quote }) => quote.payment.expectedPrice)
      )
    ),
  }).pipe(Effect.provide(layer), Effect.runPromise);

describe("public offerings", () => {
  test("advertises today's sale price, as the reservation pages do", async () => {
    const { listing, pagePrices } = await loadWithPageParity(
      saleLayer({
        calendarId: "public-offerings-today",
        firstDay: today,
        lastDay: today,
      })
    );

    expect(listing.advertisedOn.toString()).toBe(today.toString());
    expect(listing.complete).toBeTrue();
    expect(
      listing.offerings.map(({ kind, price, advertisedPrice }) => ({
        kind,
        price: price.value,
        advertised: advertisedPrice.price.value,
        discount: advertisedPrice.discount.value,
      }))
    ).toEqual([
      { kind: "cowork", price: 29_000, advertised: 23_200, discount: 5800 },
      { kind: "cowork", price: 41_000, advertised: 32_800, discount: 8200 },
      {
        kind: "meeting-room",
        price: 35_000,
        advertised: 28_000,
        discount: 7000,
      },
      {
        kind: "meeting-room",
        price: 98_000,
        advertised: 78_400,
        discount: 19_600,
      },
      {
        kind: "meeting-room",
        price: 182_000,
        advertised: 145_600,
        discount: 36_400,
      },
      // One office day with one seat: access plus the seat.
      { kind: "office", price: 53_000, advertised: 67_600, discount: 16_900 },
    ]);
    expect(
      listing.offerings.map(({ advertisedPrice }) => advertisedPrice.price)
    ).toEqual(pagePrices);
  });

  test("advertises the regular price when no sale runs today", async () => {
    const { listing, pagePrices } = await loadWithPageParity(
      saleLayer({
        calendarId: "public-offerings-ended",
        firstDay: today.subtract({ days: 3 }),
        lastDay: today.subtract({ days: 1 }),
      })
    );

    expect(
      listing.offerings.map(({ advertisedPrice }) => advertisedPrice.discount)
    ).toEqual(listing.offerings.map(() => currencyCZK(0)));
    expect(listing.offerings[0]?.advertisedPrice.price).toEqual(
      currencyCZK(29_000)
    );
    expect(
      listing.offerings.map(({ advertisedPrice }) => advertisedPrice.price)
    ).toEqual(pagePrices);
  });

  test("uses catalog prices when Calendar fails, then recovers the sale", async () => {
    let calendarFails = true;
    const layer = saleLayer({
      calendarId: "public-offerings-calendar-recovery",
      firstDay: today,
      lastDay: today,
      listEvents: (events) =>
        calendarFails
          ? Effect.fail(
              new GoogleCalendarAPIError({
                operation: "listEvents",
                message: "Calendar is unavailable.",
              })
            )
          : Effect.succeed(events),
    });
    const { failed, recovered } = await Effect.gen(function* () {
      const failed = yield* loadPublicOfferings(locale);
      calendarFails = false;
      const recovered = yield* loadPublicOfferings(locale);
      return { failed, recovered };
    }).pipe(Effect.provide(layer), Effect.runPromise);

    expect(failed.complete).toBeFalse();
    expect(
      failed.offerings.map(({ advertisedPrice }) => advertisedPrice.discount)
    ).toEqual(failed.offerings.map(() => currencyCZK(0)));
    expect(failed.offerings[0]?.advertisedPrice.price).toEqual(
      currencyCZK(29_000)
    );
    expect(recovered.complete).toBeTrue();
    expect(recovered.offerings[0]?.advertisedPrice.price).toEqual(
      currencyCZK(23_200)
    );
  });
});
