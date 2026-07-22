import { Schema } from "effect";
import { type Locale, locales } from "@/features/i18n";

const submitReservationSchema = Schema.Struct({
  locale: Schema.Literals(locales),
  payStateToken: Schema.NonEmptyString,
  legalConsent: Schema.optionalKey(Schema.Boolean),
});

const submitReservationStandardSchema = Schema.toStandardSchemaV1(
  submitReservationSchema
);

export const getSubmitReservationSchema = () => submitReservationStandardSchema;

export type SubmitReservationInput = typeof submitReservationSchema.Type;

export const getSubmitReservationCheckoutLocale = (
  input: Pick<SubmitReservationInput, "locale">,
  _contextLocale: Locale
): Locale => input.locale;
