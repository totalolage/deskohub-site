import { Effect } from "effect";
import type { DiscountQuote } from "@/features/discounts";
import {
  type CoworkReservationQuote,
  type CoworkReservationQuoteOrder,
  calculateCoworkReservationQuote,
} from "./checkout-quote";

export const buildCoworkReservationQuote = (
  order: CoworkReservationQuoteOrder,
  options: {
    readonly discountQuote?: DiscountQuote;
  } = {}
): CoworkReservationQuote =>
  Effect.runSync(calculateCoworkReservationQuote(order, options));
