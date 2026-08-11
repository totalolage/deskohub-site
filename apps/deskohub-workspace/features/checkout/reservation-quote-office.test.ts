import "@/shared/polyfills/temporal";

import { describe, expect, test } from "bun:test";
import { Effect, Schema } from "effect";
import { plainDateStringSchema } from "@/shared/utils/temporal";
import { getOfficeReservationQuote } from "./reservation-quote-office";

const decodePlainDate = Schema.decodeUnknownSync(plainDateStringSchema);

describe("getOfficeReservationQuote", () => {
  test("charges the daily base plus every seat for every day", () => {
    const quote = Effect.runSync(
      getOfficeReservationQuote({
        kind: "office",
        startsOn: decodePlainDate("2099-06-10"),
        endsOn: decodePlainDate("2099-06-11"),
        seats: 3,
      })
    );

    expect(quote.items).toEqual([
      {
        type: "office",
        dayCount: 2,
        seats: 3,
        accessAmount: { value: 106_000, exponent: 2, currency: "CZK" },
        seatAmount: { value: 63_000, exponent: 2, currency: "CZK" },
        amount: { value: 295_000, exponent: 2, currency: "CZK" },
      },
    ]);
    expect(quote.payment.expectedPrice.value).toBe(295_000);
  });
});
