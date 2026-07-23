import {
  type CoworkReservationQuote,
  checkoutSummarySchema,
} from "@/features/checkout/checkout-quote";
import { makeCheckoutDetailsSchema } from "@/features/checkout/schemas/checkout-details-base";
import type { Locale } from "@/features/i18n";
import {
  coworkReservationDetailsSchema,
  getCoworkReservationDetails,
  type NormalizedCoworkReservationOrder,
} from "@/features/reservation/cowork-reservation";

export const coworkCheckoutDetailsJsonSchema = makeCheckoutDetailsSchema({
  reservation: coworkReservationDetailsSchema,
  paymentFields: {
    summary: checkoutSummarySchema,
  },
});

export type CoworkCheckoutDetailsJson =
  typeof coworkCheckoutDetailsJsonSchema.Type;

export const getCoworkCheckoutDetails = (input: {
  readonly locale: Locale;
  readonly reservation: NormalizedCoworkReservationOrder;
  readonly quote: CoworkReservationQuote;
  readonly legalEvidence: CoworkCheckoutDetailsJson["legal"];
}): CoworkCheckoutDetailsJson => ({
  locale: input.locale,
  reservation: getCoworkReservationDetails(input.reservation),
  payment: {
    expectedPrice: input.quote.payment.expectedPrice,
    undiscountedPrice: input.quote.payment.undiscountedPrice,
    discounts: [...input.quote.payment.discounts],
    summary: input.quote.summary,
  },
  legal: input.legalEvidence,
});
