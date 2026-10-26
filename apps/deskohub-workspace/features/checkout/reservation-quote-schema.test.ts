import { describe, expect, test } from "bun:test";
import { Schema } from "effect";
import { discountIdSchema } from "@/features/discounts/contracts";
import { currencyCZK } from "@/shared/money/currencies";
import { getReservationQuoteDiscountLastDay } from "./reservation-quote-schema";

const applied = (id: string, expiresAt?: string) => ({
  discount: {
    id: Schema.decodeUnknownSync(discountIdSchema)(id),
    label: id,
    adjustment: { kind: "percentage" as const, basisPoints: 1000 },
    ...(expiresAt && { expiresAt }),
  },
  subtotalBefore: currencyCZK(10_000),
  amount: currencyCZK(1000),
  subtotalAfter: currencyCZK(9000),
});

describe("getReservationQuoteDiscountLastDay", () => {
  test("ends on the Prague day before the earliest exclusive expiry", () => {
    expect(
      getReservationQuoteDiscountLastDay({
        discounts: [
          // Prague midnight starting 2 December, in winter time.
          applied("winter", "2099-12-01T23:00:00.000Z"),
          // Prague midnight starting 2 August, in summer time.
          applied("summer", "2099-08-01T22:00:00.000Z"),
        ],
      })
    ).toBe("2099-08-01");
  });

  test("has no last day when no included discount expires", () => {
    expect(
      getReservationQuoteDiscountLastDay({
        discounts: [applied("open-ended")],
      })
    ).toBeUndefined();
    expect(
      getReservationQuoteDiscountLastDay({ discounts: [] })
    ).toBeUndefined();
  });
});
