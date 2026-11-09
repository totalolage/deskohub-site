import { Schema } from "effect";
import { appliedDiscountCodec } from "@/features/discounts/contracts";
import { getWorkspaceDate } from "@/features/reservation/reservation-date";
import { moneyWithValue, nonNegativeMoneyCodec } from "@/shared/money/money";

export const reservationQuotePaymentSchema = Schema.Struct({
  expectedPrice: nonNegativeMoneyCodec,
  undiscountedPrice: nonNegativeMoneyCodec,
  discounts: Schema.Array(appliedDiscountCodec),
});

export type ReservationQuotePayment = typeof reservationQuotePaymentSchema.Type;

/** The discount included in the expected price; zero without one. */
export const getReservationQuoteDiscount = ({
  expectedPrice,
  undiscountedPrice,
}: Pick<ReservationQuotePayment, "expectedPrice" | "undiscountedPrice">) =>
  moneyWithValue(undiscountedPrice.value - expectedPrice.value, expectedPrice);

/**
 * The last Prague day the quote's discounts can be booked: the day the
 * earliest expiring one ends on. Absent when no included discount expires.
 */
export const getReservationQuoteDiscountLastDay = ({
  discounts,
}: Pick<ReservationQuotePayment, "discounts">) => {
  const expiries = discounts.flatMap(({ discount }) =>
    discount.expiresAt ? [Temporal.Instant.from(discount.expiresAt)] : []
  );
  const earliest = expiries.reduce<Temporal.Instant | undefined>(
    (current, expiry) =>
      current && Temporal.Instant.compare(current, expiry) <= 0
        ? current
        : expiry,
    undefined
  );

  // The expiry is exclusive, so the last bookable day is the one before it.
  return (
    earliest &&
    getWorkspaceDate(earliest.subtract({ nanoseconds: 1 })).toString()
  );
};

export const makeReservationQuoteSchema = <Items extends Schema.Top>(
  items: Items
) =>
  Schema.Struct({
    items,
    fingerprint: Schema.NonEmptyString,
    payment: reservationQuotePaymentSchema,
  });
