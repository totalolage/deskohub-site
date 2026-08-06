import { Schema } from "effect";
import type { OfficeReservationQuote } from "@/features/checkout/reservation-quote-office";
import { officeReservationQuoteItemSchema } from "@/features/checkout/reservation-quote-office";
import { makeCheckoutDetailsSchema } from "@/features/checkout/schemas/checkout-details-base";
import type { Locale } from "@/features/i18n";
import {
  getOfficeReservationDetails,
  type NormalizedOfficeReservationOrder,
  officeReservationDetailsSchema,
} from "@/features/reservation/office-reservation";

export const officeCheckoutDetailsSchema = makeCheckoutDetailsSchema({
  reservation: officeReservationDetailsSchema,
  paymentFields: {
    items: Schema.Array(officeReservationQuoteItemSchema),
  },
});

export type OfficeCheckoutDetails = typeof officeCheckoutDetailsSchema.Type;

export const getOfficeCheckoutDetails = (input: {
  readonly locale: Locale;
  readonly reservation: NormalizedOfficeReservationOrder;
  readonly quote: OfficeReservationQuote;
  readonly legalEvidence: OfficeCheckoutDetails["legal"];
}): OfficeCheckoutDetails => ({
  locale: input.locale,
  reservation: getOfficeReservationDetails(input.reservation),
  payment: {
    expectedPrice: input.quote.payment.expectedPrice,
    undiscountedPrice: input.quote.payment.undiscountedPrice,
    discounts: [...input.quote.payment.discounts],
    items: input.quote.items,
  },
  legal: input.legalEvidence,
});
