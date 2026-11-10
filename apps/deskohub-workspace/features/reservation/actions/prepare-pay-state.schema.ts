import type { StandardSchemaV1 } from "@standard-schema/spec";
import { Schema } from "effect";
import { defaultPhoneRegion, locales } from "@/features/i18n";
import { reservationOrderIssuanceSchema } from "@/features/reservation/reservation-order";
import {
  marketingConsentSourceRequiresConsent,
  preparePayStateCommonSchema,
} from "./prepare-pay-state-common.schema";

/**
 * One reservation submission the booking operation prepares Pay for. Its
 * phone is read in the default region of the submission's own `locale`, the
 * locale the form validated it in and every later parse reads it with, so
 * validation and parsing can't use different regions. A form left open after
 * the visitor's language changes elsewhere still submits in its own locale.
 */
export const preparePayStateInputSchema = Schema.Union(
  locales.map((locale) =>
    Schema.Struct({
      ...preparePayStateCommonSchema.fields,
      locale: Schema.Literal(locale),
      reservation: reservationOrderIssuanceSchema(defaultPhoneRegion(locale)),
    })
  )
).check(marketingConsentSourceRequiresConsent);

export const preparePayStateSchema = Schema.toStandardSchemaV1(
  preparePayStateInputSchema,
  { parseOptions: { onExcessProperty: "error" } }
);

export type PreparePayStateInput = StandardSchemaV1.InferOutput<
  typeof preparePayStateSchema
>;
