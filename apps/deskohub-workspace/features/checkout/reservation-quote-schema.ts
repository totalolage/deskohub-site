import { Schema } from "effect";
import {
  nonNegativeWorkspaceMoneyCodec,
  workspaceMoneyWithValue,
} from "@/features/checkout/workspace-money";
import { appliedDiscountCodec } from "@/features/discounts/contracts";

export const reservationQuotePaymentSchema = Schema.Struct({
  expectedPrice: nonNegativeWorkspaceMoneyCodec,
  undiscountedPrice: nonNegativeWorkspaceMoneyCodec,
  discounts: Schema.Array(appliedDiscountCodec),
});

export type ReservationQuotePayment = typeof reservationQuotePaymentSchema.Type;

/** The discount included in the expected price; zero without one. */
export const getReservationQuoteDiscount = ({
  expectedPrice,
  undiscountedPrice,
}: Pick<ReservationQuotePayment, "expectedPrice" | "undiscountedPrice">) =>
  workspaceMoneyWithValue(
    undiscountedPrice.value - expectedPrice.value,
    expectedPrice
  );

export const makeReservationQuoteSchema = <Items extends Schema.Top>(
  items: Items
) =>
  Schema.Struct({
    items,
    fingerprint: Schema.NonEmptyString,
    payment: reservationQuotePaymentSchema,
  });
