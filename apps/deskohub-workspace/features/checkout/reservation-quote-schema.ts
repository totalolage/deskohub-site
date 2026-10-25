import { Schema } from "effect";
import { appliedDiscountCodec } from "@/features/discounts/contracts";
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

export const makeReservationQuoteSchema = <Items extends Schema.Top>(
  items: Items
) =>
  Schema.Struct({
    items,
    fingerprint: Schema.NonEmptyString,
    payment: reservationQuotePaymentSchema,
  });
