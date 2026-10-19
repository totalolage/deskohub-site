import { describe, expect, test } from "bun:test";
import { Effect, Schema } from "effect";
import type {
  AdvertisedPriceRequest,
  PreloadedAdvertisedPrice,
} from "@/features/checkout/advertised-price";
import {
  buildCoworkCheckoutSummary,
  buildCoworkReservationQuote,
} from "@/features/checkout/checkout-quote.test-utils";
import { getMeetingRoomCheckoutSummary } from "@/features/checkout/checkout-summary-meeting-room";
import { getOfficeCheckoutSummary } from "@/features/checkout/checkout-summary-office";
import { workspaceMeetingRoomProductsByDurationKey } from "@/features/checkout/meeting-room-product-catalog";
import {
  getWorkspaceOfficeAccessPrice,
  getWorkspaceOfficeSeatPrice,
  getWorkspaceProductByTier,
  getWorkspaceProductCoffeeLinePriceForTier,
  workspaceProductWorkstationAddonPrice,
} from "@/features/checkout/product-catalog";
import { buildOfficeReservationQuote } from "@/features/checkout/reservation-quote-office";
import { currencyCZK } from "@/features/checkout/workspace-money";
import { discountIdSchema } from "@/features/discounts/contracts";
import { getCoworkDateAdvertisedPriceRequests } from "@/features/reservation/cowork-advertised-price";
import { getMeetingRoomDurationAdvertisedPriceRequests } from "@/features/reservation/meeting-room-advertised-price";
import { getOfficeAdvertisedPriceRequest } from "@/features/reservation/office-advertised-price";
import { plainDateStringSchema } from "@/shared/utils/temporal";
import {
  getCoworkPageOfferings,
  getMeetingRoomPageOfferings,
  getOfficePageOfferings,
} from "./reservation-page-offerings";

const date = "2099-07-30";

const halfPriceSale = (subtotal: { readonly value: number }) => {
  const half = currencyCZK(subtotal.value / 2);
  return {
    discountableSubtotal: currencyCZK(subtotal.value),
    discounts: [
      {
        discount: {
          id: Schema.decodeUnknownSync(discountIdSchema)("summer-sale"),
          label: "Summer sale",
          adjustment: { kind: "percentage" as const, basisPoints: 5000 },
        },
        subtotalBefore: currencyCZK(subtotal.value),
        amount: half,
        subtotalAfter: half,
      },
    ],
    totalDiscount: half,
    discountedSubtotal: half,
  };
};

/** The cowork price the server advertises for a request, with Open Space at half price. */
const advertiseCowork = (
  request: AdvertisedPriceRequest
): PreloadedAdvertisedPrice => {
  if (request.reservation.kind !== "cowork") {
    throw new Error("Expected a cowork request");
  }
  const { details } = request.reservation;
  const order =
    details.entryTier === "open-space"
      ? { entryTier: "open-space" as const, coffee: details.coffee }
      : {
          entryTier: "reserved-desk" as const,
          coffee: true,
          ...(details.workstation && { monitorOption: "2x27-qhd" as const }),
        };
  const options =
    details.entryTier === "open-space"
      ? {
          discountQuote: {
            product: { kind: "cowork" as const, tier: "open-space" as const },
            ...halfPriceSale(getWorkspaceProductByTier("open-space").price),
          },
        }
      : {};

  return {
    request,
    advertisedPrice: {
      kind: "cowork",
      quote: buildCoworkReservationQuote(order, options),
      summary: buildCoworkCheckoutSummary(order, options),
      advertisedPriceToken: "sealed",
    },
  };
};

describe("getCoworkPageOfferings", () => {
  test("offers each tier at the price its card shows", () => {
    const [openSpace, reservedDesk] = getCoworkPageOfferings({
      advertisedPrices: getCoworkDateAdvertisedPriceRequests({
        date,
        locale: "en-US",
      }).map(advertiseCowork),
      coffee: false,
      date,
      locale: "en-US",
    });

    expect(openSpace?.price).toEqual(currencyCZK(14_500));
    expect(reservedDesk?.price).toEqual(
      getWorkspaceProductByTier("reserved-desk").price
    );
    expect(
      openSpace?.kind === "cowork" &&
        openSpace.addOns.find(({ id }) => id === "coffee")?.price
    ).toEqual(getWorkspaceProductCoffeeLinePriceForTier("open-space"));
    expect(
      reservedDesk?.kind === "cowork" &&
        reservedDesk.addOns.find(({ id }) => id === "workstation")?.price
    ).toEqual(workspaceProductWorkstationAddonPrice);
  });

  test("keeps catalog prices the page could not preload", () => {
    const offerings = getCoworkPageOfferings({
      advertisedPrices: [],
      coffee: false,
      date,
      locale: "en-US",
    });

    expect(offerings.map(({ price }) => price)).toEqual([
      getWorkspaceProductByTier("open-space").price,
      getWorkspaceProductByTier("reserved-desk").price,
    ]);
  });

  test("ignores prices preloaded for another date", () => {
    const [openSpace] = getCoworkPageOfferings({
      advertisedPrices: getCoworkDateAdvertisedPriceRequests({
        date: "2099-07-31",
        locale: "en-US",
      }).map(advertiseCowork),
      coffee: false,
      date,
      locale: "en-US",
    });

    expect(openSpace?.price).toEqual(
      getWorkspaceProductByTier("open-space").price
    );
  });
});

describe("getMeetingRoomPageOfferings", () => {
  test("offers each duration at its preloaded price or the catalog price", () => {
    const startDateTime = `${date}T10:00`;
    const fourHours = getMeetingRoomDurationAdvertisedPriceRequests({
      locale: "en-US",
      startDateTime,
    }).find(
      ({ reservation: { details } }) =>
        details.duration.unit === "hour" && details.duration.amount === 4
    );
    if (!fourHours) throw new Error("Expected a four-hour request");
    const { price } = workspaceMeetingRoomProductsByDurationKey["hour:4"];
    const sale = halfPriceSale(price);
    const quote = {
      fingerprint: "meeting-room-hour-4-sale",
      items: [
        {
          type: "meeting-room" as const,
          duration: fourHours.reservation.details.duration,
          amount: price,
        },
      ] as const,
      payment: {
        expectedPrice: sale.discountedSubtotal,
        undiscountedPrice: price,
        discounts: sale.discounts,
      },
    };

    const offerings = getMeetingRoomPageOfferings({
      advertisedPrices: [
        {
          request: fourHours,
          advertisedPrice: {
            kind: "meeting-room",
            quote,
            summary: getMeetingRoomCheckoutSummary(quote),
            advertisedPriceToken: "sealed",
          },
        },
      ],
      locale: "en-US",
      startDateTime,
    });

    expect(offerings.map(({ price }) => price)).toEqual([
      workspaceMeetingRoomProductsByDurationKey["hour:1"].price,
      currencyCZK(49_000),
      workspaceMeetingRoomProductsByDurationKey["day:1"].price,
    ]);
  });
});

describe("getOfficePageOfferings", () => {
  const decodePlainDate = Schema.decodeUnknownSync(plainDateStringSchema);
  const selection = {
    startsOn: decodePlainDate("2099-08-10"),
    endsOn: decodePlainDate("2099-08-11"),
    seats: 2,
  };

  test("offers the selection's advertised amounts per day", () => {
    const request = getOfficeAdvertisedPriceRequest({
      ...selection,
      locale: "en-US",
    });
    const quote = Effect.runSync(
      buildOfficeReservationQuote(request.reservation.details)
    );

    const [office] = getOfficePageOfferings({
      advertisedPrices: [
        {
          request,
          advertisedPrice: {
            kind: "office",
            quote,
            summary: getOfficeCheckoutSummary(quote),
            advertisedPriceToken: "sealed",
          },
        },
      ],
      locale: "en-US",
      seatCapacity: 4,
      selection,
    });

    // The two-day quote shows the access and seat amounts for both days.
    expect(quote.items[0].accessAmount).toEqual(
      getWorkspaceOfficeAccessPrice(2)
    );
    expect(office).toMatchObject({
      kind: "office",
      price: getWorkspaceOfficeAccessPrice(1),
      seatPrice: getWorkspaceOfficeSeatPrice(1),
      maximumSeats: 4,
    });
  });
});
