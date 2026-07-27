import { Effect, Schema } from "effect";
import { getCoworkCheckoutSummary } from "@/features/checkout/checkout-summary-cowork";
import type { DiscountQuote } from "@/features/discounts";
import { coworkReservationProductSchema } from "@/features/reservation/cowork-reservation-product";
import {
  buildCoworkReservationQuote as buildCoworkReservationQuoteEffect,
  type CoworkReservationQuote,
} from "./reservation-quote-cowork";

export type CoworkReservationQuoteOrder =
  typeof coworkReservationProductSchema.Encoded;

const decodeCoworkReservationProduct = Schema.decodeUnknownSync(
  coworkReservationProductSchema
);

const getNormalizedCoworkReservation = (
  order: CoworkReservationQuoteOrder
) => ({
  kind: "cowork" as const,
  ...decodeCoworkReservationProduct(order),
  date: "2099-01-01",
});

export const buildCoworkReservationQuote = (
  order: CoworkReservationQuoteOrder,
  options: {
    readonly discountQuote?: DiscountQuote;
  } = {}
): CoworkReservationQuote => {
  const reservation = getNormalizedCoworkReservation(order);
  return Effect.runSync(
    buildCoworkReservationQuoteEffect(reservation, options)
  );
};

export const buildCoworkCheckoutSummary = (
  order: CoworkReservationQuoteOrder,
  options: {
    readonly discountQuote?: DiscountQuote;
  } = {}
) => {
  const reservation = getNormalizedCoworkReservation(order);
  return getCoworkCheckoutSummary(
    reservation,
    buildCoworkReservationQuote(order, options)
  );
};
