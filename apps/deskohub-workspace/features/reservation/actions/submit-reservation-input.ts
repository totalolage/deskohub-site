import { Schema } from "effect";
import { locales } from "@/features/i18n";

const submitReservationInputSchema = Schema.Struct({
  locale: Schema.Literals(locales),
  payStateToken: Schema.NonEmptyString,
  legalConsent: Schema.optionalKey(Schema.Boolean),
});

export const submitReservationSchema = Schema.toStandardSchemaV1(
  submitReservationInputSchema
);

export type SubmitReservationInput = typeof submitReservationInputSchema.Type;
