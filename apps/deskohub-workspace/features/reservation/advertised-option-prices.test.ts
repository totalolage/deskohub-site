import { describe, expect, test } from "bun:test";
import "@/shared/polyfills/temporal";
import { workspaceMeetingRoomProductsByDurationKey } from "@/features/checkout/meeting-room-product-catalog";
import { currencyCZK } from "@/shared/money/currencies";
import {
  findAdvertisedPriceRequestIndex,
  getPreloadedOptionPrices,
} from "./advertised-option-prices";
import {
  advertiseCowork,
  advertiseMeetingRoom,
} from "./advertised-price.test-utils";
import { getCoworkFormAdvertisedPriceRequests } from "./cowork-advertised-price";
import {
  getMeetingRoomDurationAdvertisedPriceRequests,
  meetingRoomDurationOptions,
} from "./meeting-room-advertised-price";

const morningRequests = getMeetingRoomDurationAdvertisedPriceRequests({
  locale: "en-US",
  startDateTime: "2099-07-30T10:00",
});
const [oneHour, fourHours, wholeDay] = morningRequests;
if (!(oneHour && fourHours && wholeDay)) {
  throw new Error("Expected a request per meeting-room duration");
}

describe("advertised option prices", () => {
  test("looks a price up by an equal request, not the same object", () => {
    const prices = getPreloadedOptionPrices(
      morningRequests,
      meetingRoomDurationOptions,
      [advertiseMeetingRoom(fourHours, { token: "four-hours" })]
    );

    expect(
      prices.priceOf(structuredClone(fourHours))?.advertisedPriceToken
    ).toBe("four-hours");
    expect(prices.priceOf(oneHour)).toBeUndefined();
  });

  test("tells options of the same duration on other dates apart", () => {
    const [nextDayFourHours] = getMeetingRoomDurationAdvertisedPriceRequests({
      locale: "en-US",
      startDateTime: "2099-07-31T10:00",
    }).slice(1);
    if (!nextDayFourHours) throw new Error("Expected a four-hour request");

    const prices = getPreloadedOptionPrices(
      morningRequests,
      meetingRoomDurationOptions,
      [advertiseMeetingRoom(nextDayFourHours)]
    );

    expect(prices.priceOf(fourHours)).toBeUndefined();
    expect(prices.priceOf(nextDayFourHours)).toBeUndefined();
  });

  test("prices only the form's own requests and family", () => {
    const [openSpace] = getCoworkFormAdvertisedPriceRequests({
      coffee: false,
      date: "2099-07-30",
      locale: "en-US",
    });
    if (!openSpace) throw new Error("Expected an Open Space request");
    const coworkPrice = advertiseCowork(openSpace);

    const prices = getPreloadedOptionPrices(
      morningRequests,
      meetingRoomDurationOptions,
      // A cowork price filed under a meeting-room request is not the family's.
      [{ request: fourHours, advertisedPrice: coworkPrice.advertisedPrice }]
    );

    expect(prices.priceOf(fourHours)).toBeUndefined();
    expect(prices.of(fourHours)).toBeUndefined();
    expect(findAdvertisedPriceRequestIndex(morningRequests, openSpace)).toBe(
      -1
    );
    expect(findAdvertisedPriceRequestIndex(morningRequests, undefined)).toBe(
      -1
    );
  });

  test("shows the duration's amount beside its price before the sale", () => {
    const sale = advertiseMeetingRoom(fourHours, {
      saleExpiresAt: "2099-08-01T22:00:00.000Z",
    });
    const prices = getPreloadedOptionPrices(
      morningRequests,
      meetingRoomDurationOptions,
      [advertiseMeetingRoom(oneHour), sale]
    );

    expect(prices.of(fourHours)).toEqual({
      amount: currencyCZK(49_000),
      originalAmount: workspaceMeetingRoomProductsByDurationKey["hour:4"].price,
      advertisedPrice: sale.advertisedPrice,
    });
    expect(prices.of(oneHour)).toEqual({
      amount: workspaceMeetingRoomProductsByDurationKey["hour:1"].price,
      advertisedPrice: advertiseMeetingRoom(oneHour).advertisedPrice,
    });
  });
});
