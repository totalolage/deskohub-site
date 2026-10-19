import "@/shared/polyfills/temporal";
import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { GoogleCalendarAPIError } from "@deskohub/google-calendar";
import { Effect, Layer } from "effect";
import type { AdvertisedPriceRequest } from "@/features/checkout/advertised-price";
import { workspaceMeetingRoomCatalog } from "@/features/checkout/meeting-room-product-catalog";
import { workspaceCoworkCurrentTiers } from "@/features/checkout/product-catalog";
import { currencyCZK } from "@/features/checkout/workspace-money";
import { calendarSaleDiscountServiceLayer } from "@/features/discounts/calendar-sale.test-utils";
import { OfficeReservationFeatureFlagService } from "@/features/office/backend/office-reservation-feature-flag.service";
import { AdvisoryAvailabilityInventory } from "@/features/reservation/backend/availability-inventory";
import { getCoworkDateAdvertisedPriceRequests } from "@/features/reservation/cowork-advertised-price";
import { getMeetingRoomDurationAdvertisedPriceRequests } from "@/features/reservation/meeting-room-advertised-price";
import { getMeetingRoomReservationDurationKey } from "@/features/reservation/meeting-room-reservation-duration";
import { getOfficeSeatAdvertisedPriceRequests } from "@/features/reservation/office-advertised-price";
import { getCurrentWorkspaceDate } from "@/features/reservation/reservation-date";
import { withInstantSleeps } from "@/shared/testing/workspace-test-clock.test-utils";
import { CheckoutPricingService } from "./checkout-pricing.service";
import { loadPublicOfferings, loadPublicPriceList } from "./public-offerings";

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

/** The sale layer with the advertisements of the matching requests replaced. */
const withQuotes = (
  layer: ReturnType<typeof saleLayer>,
  replaces: (request: AdvertisedPriceRequest) => boolean,
  quote: Effect.Effect<never>
) =>
  Layer.effect(
    CheckoutPricingService,
    CheckoutPricingService.pipe(
      Effect.map((pricing) => ({
        ...pricing,
        quoteAdvertisement: (request: AdvertisedPriceRequest) =>
          replaces(request) ? quote : pricing.quoteAdvertisement(request),
      }))
    )
  ).pipe(Layer.provideMerge(layer));

const todaysSale = () =>
  saleLayer({
    calendarId: "public-price-list-today",
    firstDay: today,
    lastDay: today,
  });

/** Every product as `family:choice`, from the catalogs. */
const catalogProducts = [
  ...workspaceCoworkCurrentTiers.map((tier) => `cowork:${tier}`),
  ...workspaceMeetingRoomCatalog.map(
    ({ duration }) =>
      `meeting-room:${getMeetingRoomReservationDurationKey(duration)}`
  ),
  "office",
];

const describeProduct = (
  offering: Effect.Success<
    ReturnType<typeof loadPublicPriceList>
  >["offerings"][number]
) => {
  switch (offering.kind) {
    case "cowork":
      return `cowork:${offering.tier}`;
    case "meeting-room":
      return `meeting-room:${getMeetingRoomReservationDurationKey(offering.duration)}`;
    case "office":
      return "office";
  }
};

describe("public price list", () => {
  test("lists every catalog product at its advertised sale price", async () => {
    const { offerings } = await loadPublicPriceList(locale).pipe(
      Effect.provide(todaysSale()),
      Effect.runPromise
    );

    expect(offerings.map(describeProduct)).toEqual(catalogProducts);
    expect(
      offerings.map((offering) => offering.advertisedPrice?.discount.value)
    ).toEqual([5800, 8200, 7000, 19_600, 36_400, 16_900]);
  });

  test("keeps the catalog price of a family whose quote fails", async () => {
    const { offerings } = await loadPublicPriceList(locale).pipe(
      Effect.provide(
        withQuotes(
          todaysSale(),
          ({ reservation }) => reservation.kind === "meeting-room",
          Effect.die(new Error("Pricing is unavailable"))
        )
      ),
      Effect.runPromise
    );

    expect(offerings.map(describeProduct)).toEqual(catalogProducts);
    expect(
      offerings.map(({ kind, price, advertisedPrice }) => ({
        kind,
        price: price.value,
        advertised: advertisedPrice?.price.value,
      }))
    ).toEqual([
      { kind: "cowork", price: 29_000, advertised: 23_200 },
      { kind: "cowork", price: 41_000, advertised: 32_800 },
      { kind: "meeting-room", price: 35_000, advertised: undefined },
      { kind: "meeting-room", price: 98_000, advertised: undefined },
      { kind: "meeting-room", price: 182_000, advertised: undefined },
      { kind: "office", price: 53_000, advertised: 67_600 },
    ]);
  });

  test("keeps the catalog prices when the quotes miss the page deadline", async () => {
    // Build the services on the real clock; only the load runs on the test clock.
    const { offerings } = await Layer.build(
      withQuotes(todaysSale(), () => true, Effect.never)
    ).pipe(
      Effect.flatMap((services) =>
        loadPublicPriceList(locale).pipe(
          withInstantSleeps,
          Effect.provide(services)
        )
      ),
      Effect.scoped,
      Effect.runPromise
    );

    expect(offerings.map(describeProduct)).toEqual(catalogProducts);
    expect(offerings.map(({ advertisedPrice }) => advertisedPrice)).toEqual(
      catalogProducts.map(() => undefined)
    );
    expect(offerings.at(-1)).toMatchObject({
      kind: "office",
      price: currencyCZK(53_000),
      seatPrice: currencyCZK(31_500),
    });
  });

  test("never reads the availability inventory, even with the office open", async () => {
    let inventoryReads = 0;
    const countingInventory = Layer.succeed(AdvisoryAvailabilityInventory, {
      tables: Effect.sync(() => {
        inventoryReads += 1;
        return [];
      }),
      listActiveReservationsOverlapping: () => Effect.succeed([]),
      listLimitations: () => Effect.succeed([]),
    });
    const services = Layer.merge(todaysSale(), countingInventory);

    const { offerings } = await loadPublicPriceList(locale).pipe(
      Effect.provide(services),
      Effect.runPromise
    );
    expect(offerings.map(describeProduct)).toEqual(catalogProducts);
    expect(inventoryReads).toBe(0);

    // The strict offerings still read the office seat maximum.
    await loadPublicOfferings(locale).pipe(
      Effect.provide(services),
      Effect.runPromise
    );
    expect(inventoryReads).toBe(1);
  });

  test("still fails the strict offerings read when a quote fails", async () => {
    const exit = await loadPublicOfferings(locale).pipe(
      Effect.provide(
        withQuotes(
          todaysSale(),
          ({ reservation }) => reservation.kind === "office",
          Effect.die(new Error("Pricing is unavailable"))
        )
      ),
      Effect.exit,
      Effect.runPromise
    );

    expect(exit._tag).toBe("Failure");
  });
});
