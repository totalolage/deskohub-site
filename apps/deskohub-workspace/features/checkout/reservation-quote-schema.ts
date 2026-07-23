import { Schema } from "effect";
import { nonNegativeWorkspaceMoneyCodec } from "@/features/checkout/workspace-money";
import { appliedDiscountCodec } from "@/features/discounts/contracts";

export const reservationQuotePaymentSchema = Schema.Struct({
  expectedPrice: nonNegativeWorkspaceMoneyCodec,
  undiscountedPrice: nonNegativeWorkspaceMoneyCodec,
  discounts: Schema.Array(appliedDiscountCodec),
});

export type ReservationQuotePayment = typeof reservationQuotePaymentSchema.Type;

export const makeReservationQuoteSchema = <Items extends Schema.Top>(
  items: Items
) =>
  Schema.Struct({
    items,
    fingerprint: Schema.NonEmptyString,
    payment: reservationQuotePaymentSchema,
  });
