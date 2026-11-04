import { describe, expect, test } from "bun:test";
import { Schema } from "effect";
import { workspaceMeetingRoomProductsByDurationKey } from "@/features/checkout/meeting-room-product-catalog";
import {
  getWorkspaceOfficeAccessPrice,
  getWorkspaceOfficeSeatPrice,
  getWorkspaceProductByTier,
  getWorkspaceProductCoffeeLinePriceForTier,
  workspaceProductWorkstationAddonPrice,
} from "@/features/checkout/product-catalog";
import { getCoworkDateAdvertisedPriceRequests } from "@/features/reservation/cowork-advertised-price";
import { getMeetingRoomDurationAdvertisedPriceRequests } from "@/features/reservation/meeting-room-advertised-price";
import { getOfficeAdvertisedPriceRequest } from "@/features/reservation/office-advertised-price";
import { currencyCZK } from "@/shared/money/currencies";
import { plainDateStringSchema } from "@/shared/utils/temporal";
import {
  advertiseCowork,
  advertiseMeetingRoom,
  advertiseOffice,
} from "./advertised-price.test-utils";
import {
  getCoworkPageOfferings,
  getMeetingRoomPageOfferings,
  getOfficePageOfferings,
} from "./reservation-page-offerings";

const date = "2099-07-30";

describe("getCoworkPageOfferings", () => {
  test("advertises each tier at the price its card shows, beside the catalog price", () => {
    const [openSpace, reservedDesk] = getCoworkPageOfferings({
      advertisedPrices: getCoworkDateAdvertisedPriceRequests({
        date,
        locale: "en-US",
      }).map((request) => advertiseCowork(request)),
      coffee: false,
      date,
      locale: "en-US",
    });

    expect(openSpace?.price).toEqual(
      getWorkspaceProductByTier("open-space").price
    );
    expect(openSpace?.advertisedPrice).toEqual({
      price: currencyCZK(14_500),
      discount: currencyCZK(14_500),
    });
    expect(reservedDesk?.advertisedPrice).toEqual({
      price: getWorkspaceProductByTier("reserved-desk").price,
      discount: currencyCZK(0),
    });
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
    expect(offerings.map(({ advertisedPrice }) => advertisedPrice)).toEqual([
      undefined,
      undefined,
    ]);
  });

  test("ignores prices preloaded for another date", () => {
    const [openSpace] = getCoworkPageOfferings({
      advertisedPrices: getCoworkDateAdvertisedPriceRequests({
        date: "2099-07-31",
        locale: "en-US",
      }).map((request) => advertiseCowork(request)),
      coffee: false,
      date,
      locale: "en-US",
    });

    expect(openSpace?.advertisedPrice).toBeUndefined();
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
    const offerings = getMeetingRoomPageOfferings({
      advertisedPrices: [
        // The sale's booking window ends at Prague midnight starting 2 August.
        advertiseMeetingRoom(fourHours, {
          saleExpiresAt: "2099-08-01T22:00:00.000Z",
        }),
      ],
      locale: "en-US",
      startDateTime,
    });

    expect(offerings.map(({ price }) => price)).toEqual([
      workspaceMeetingRoomProductsByDurationKey["hour:1"].price,
      price,
      workspaceMeetingRoomProductsByDurationKey["day:1"].price,
    ]);
    expect(offerings.map(({ advertisedPrice }) => advertisedPrice)).toEqual([
      undefined,
      {
        price: currencyCZK(49_000),
        discount: currencyCZK(49_000),
        saleLastDay: "2099-08-01",
      },
      undefined,
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
    const preloaded = advertiseOffice(request);
    const { quote } = preloaded.advertisedPrice;

    const [office] = getOfficePageOfferings({
      advertisedPrices: [preloaded],
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
