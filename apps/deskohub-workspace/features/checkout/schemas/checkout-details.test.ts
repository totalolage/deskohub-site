import { describe, expect, test } from "bun:test";
import { Schema } from "effect";
import {
  checkoutDetailsLogFields,
  checkoutDetailsSchema,
} from "./checkout-details";

const price = { value: 35_000, exponent: 2, currency: "CZK" };

describe("checkoutDetailsLogFields", () => {
  test("keeps the reservation kind and discount count, not the details", () => {
    const details = Schema.decodeUnknownSync(checkoutDetailsSchema)({
      locale: "en-US",
      reservation: {
        kind: "cowork",
        entryTier: "basic",
        date: "2099-06-10",
        coffee: false,
      },
      payment: {
        expectedPrice: price,
        undiscountedPrice: price,
        discounts: [],
        summary: { sections: [], total: price },
      },
      legal: {},
    });

    expect(checkoutDetailsLogFields(details)).toEqual({
      reservationKind: "cowork",
      discountCount: 0,
    });
  });
});
