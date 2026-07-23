import { Schema } from "effect";
import { legalEvidenceMapSchema } from "@/features/checkout/legal-evidence";
import { reservationQuotePaymentSchema } from "@/features/checkout/reservation-quote-schema";
import { locales } from "@/features/i18n";

export const checkoutDetailsBaseSchema = Schema.Struct({
  locale: Schema.Literals(locales),
  legal: legalEvidenceMapSchema,
  payment: reservationQuotePaymentSchema,
});

export const makeCheckoutDetailsSchema = <
  Reservation extends Schema.Top,
  PaymentFields extends Schema.Struct.Fields,
>(input: {
  readonly reservation: Reservation;
  readonly paymentFields: PaymentFields;
}) =>
  Schema.Struct({
    ...checkoutDetailsBaseSchema.fields,
    reservation: input.reservation,
    payment: Schema.Struct({
      ...checkoutDetailsBaseSchema.fields.payment.fields,
      ...input.paymentFields,
    }),
  });
