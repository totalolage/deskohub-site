import { describe, expect, test } from "bun:test";
import {
  getWorkspaceProductByTier,
  getWorkspaceProductCoffeeLinePriceForTier,
  workspaceProductWorkstationAddonPrice,
} from "@/features/checkout/product-catalog";
import { currencyCZK } from "@/shared/money/currencies";
import { getPreloadedOptionPrices } from "./advertised-option-prices";
import { advertiseCowork } from "./advertised-price.test-utils";
import {
  coworkTierOptions,
  findCoworkAdvertisedPriceRequest,
  getCoworkAddOnAmount,
  getCoworkCoffeeAdvertisedPriceRequest,
  getCoworkFormAdvertisedPriceRequests,
  getCoworkTierOptionPrice,
} from "./cowork-advertised-price";

const requests = getCoworkFormAdvertisedPriceRequests({
  coffee: false,
  date: "2099-07-30",
  locale: "en-US",
});
const [openSpace, reservedDesk, reservedDeskWithWorkstation] = requests;
if (!(openSpace && reservedDesk && reservedDeskWithWorkstation)) {
  throw new Error("Expected Open Space and both Reserved Desk requests");
}

describe("cowork option prices", () => {
  test("prices each tier selection by its own request", () => {
    expect(
      findCoworkAdvertisedPriceRequest(requests, {
        entryTier: "open-space",
        workstation: false,
      })
    ).toBe(openSpace);
    expect(
      findCoworkAdvertisedPriceRequest(requests, {
        entryTier: "reserved-desk",
        workstation: false,
      })
    ).toBe(reservedDesk);
    expect(
      findCoworkAdvertisedPriceRequest(requests, {
        entryTier: "reserved-desk",
        workstation: true,
      })
    ).toBe(reservedDeskWithWorkstation);
    expect(
      findCoworkAdvertisedPriceRequest(requests, {
        entryTier: "basic",
        workstation: false,
      })
    ).toBeUndefined();
  });

  test("shows the tier card the first price loaded for the tier", () => {
    const prices = getPreloadedOptionPrices(requests, coworkTierOptions, [
      advertiseCowork(openSpace),
      advertiseCowork(reservedDesk, { token: "desk" }),
      advertiseCowork(reservedDeskWithWorkstation, {
        token: "desk-workstation",
      }),
    ]);

    expect(getCoworkTierOptionPrice(prices, "open-space")).toMatchObject({
      amount: currencyCZK(14_500),
      originalAmount: getWorkspaceProductByTier("open-space").price,
    });
    expect(
      getCoworkTierOptionPrice(prices, "reserved-desk")?.advertisedPrice
        .advertisedPriceToken
    ).toBe("desk");
  });

  test("falls back to the workstation variant's base price for the Reserved Desk card", () => {
    const prices = getPreloadedOptionPrices(requests, coworkTierOptions, [
      advertiseCowork(reservedDeskWithWorkstation, {
        token: "desk-workstation",
      }),
    ]);
    const tierPrice = getCoworkTierOptionPrice(prices, "reserved-desk");

    expect(tierPrice?.advertisedPrice.advertisedPriceToken).toBe(
      "desk-workstation"
    );
    expect(tierPrice?.amount).toEqual(
      getWorkspaceProductByTier("reserved-desk").price
    );
    expect(getCoworkTierOptionPrice(prices, "open-space")).toBeUndefined();
  });

  test("reads add-on amounts from the variant that carries them", () => {
    const prices = getPreloadedOptionPrices(requests, coworkTierOptions, [
      advertiseCowork(reservedDesk),
      advertiseCowork(reservedDeskWithWorkstation),
    ]);
    const coffeeRequest = getCoworkCoffeeAdvertisedPriceRequest({
      date: "2099-07-30",
      locale: "en-US",
      tier: "open-space",
    });

    expect(
      getCoworkAddOnAmount(
        prices.priceOf(reservedDeskWithWorkstation),
        "workstation"
      )
    ).toEqual(workspaceProductWorkstationAddonPrice);
    expect(
      getCoworkAddOnAmount(prices.priceOf(reservedDesk), "workstation")
    ).toBeUndefined();
    expect(
      getCoworkAddOnAmount(
        advertiseCowork(coffeeRequest).advertisedPrice,
        "coffee"
      )
    ).toEqual(getWorkspaceProductCoffeeLinePriceForTier("open-space"));
  });
});
