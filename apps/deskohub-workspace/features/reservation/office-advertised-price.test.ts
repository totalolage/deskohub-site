import { describe, expect, test } from "bun:test";
import { Schema } from "effect";
import {
  getWorkspaceOfficeAccessPrice,
  getWorkspaceOfficeSeatPrice,
} from "@/features/checkout/product-catalog";
import { moneyWithValue } from "@/shared/money/money";
import { plainDateStringSchema } from "@/shared/utils/temporal";
import { getPreloadedOptionPrices } from "./advertised-option-prices";
import { advertiseOffice } from "./advertised-price.test-utils";
import {
  findOfficeSeatAdvertisedPriceRequest,
  getOfficeSeatAdvertisedPriceRequests,
  officeSeatOptions,
} from "./office-advertised-price";

const decodePlainDate = Schema.decodeUnknownSync(plainDateStringSchema);
const requests = getOfficeSeatAdvertisedPriceRequests({
  endsOn: decodePlainDate("2099-08-11"),
  locale: "en-US",
  seatCapacity: 4,
  startsOn: decodePlainDate("2099-08-10"),
});

describe("office option prices", () => {
  test("shows each seat option as its seats' surcharge over the base price", () => {
    const threeSeats = findOfficeSeatAdvertisedPriceRequest(requests, 3);
    if (!threeSeats) throw new Error("Expected a three-seat request");
    const catalogPrice = advertiseOffice(threeSeats);
    const [catalogItem] = catalogPrice.advertisedPrice.quote.items;
    // A quoted seat amount off the catalog, as a sale would advertise it.
    const quotedSeatAmount = moneyWithValue(12_345, catalogItem.seatAmount);
    const prices = getPreloadedOptionPrices(requests, officeSeatOptions, [
      {
        ...catalogPrice,
        advertisedPrice: {
          ...catalogPrice.advertisedPrice,
          quote: {
            ...catalogPrice.advertisedPrice.quote,
            items: [{ ...catalogItem, seatAmount: quotedSeatAmount }],
          },
        },
      },
    ]);

    expect(quotedSeatAmount).not.toEqual(getWorkspaceOfficeSeatPrice(2));
    expect(prices.of(threeSeats)?.amount).toEqual(
      moneyWithValue(12_345 * 3, quotedSeatAmount)
    );
    expect(prices.of(threeSeats)?.originalAmount).toBeUndefined();
    expect(prices.priceOf(threeSeats)?.quote.items[0].accessAmount).toEqual(
      getWorkspaceOfficeAccessPrice(2)
    );
  });

  test("prices no seat option before seats are chosen", () => {
    expect(
      findOfficeSeatAdvertisedPriceRequest(requests, undefined)
    ).toBeUndefined();
  });
});
