import { describe, expect, test } from "bun:test";
import { Effect, Schema } from "effect";
import { officeReservationDetailsSchema } from "@/features/reservation/office-reservation";
import { getOfficeReservationQuote } from "./reservation-quote-office";

const decodeOfficeDetails = Schema.decodeUnknownSync(
  officeReservationDetailsSchema
);

describe("getOfficeReservationQuote", () => {
  test("charges the daily base plus every additional person for every day", () => {
    const quote = Effect.runSync(
      getOfficeReservationQuote(
        decodeOfficeDetails({
          kind: "office",
          startsOn: "2099-06-10",
          endsOn: "2099-06-11",
          additionalGuests: 2,
        })
      )
    );

    expect(quote.items).toEqual([
      {
        type: "office",
        dayCount: 2,
        additionalGuests: 2,
        amount: { value: 232_000, exponent: 2, currency: "CZK" },
      },
    ]);
    expect(quote.payment.expectedPrice.value).toBe(232_000);
  });
});
