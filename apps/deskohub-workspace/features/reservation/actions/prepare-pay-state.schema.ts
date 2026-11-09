import type { StandardSchemaV1 } from "@standard-schema/spec";
import { Schema } from "effect";
import { defaultPhoneRegion, type Locale } from "@/features/i18n";
import { reservationOrderIssuanceSchema } from "@/features/reservation/reservation-order";
import {
  marketingConsentSourceRequiresConsent,
  preparePayStateCommonSchema,
} from "./prepare-pay-state-common.schema";

/**
 * One reservation submission in `locale` the booking operation prepares Pay
 * for. The phone is read in the locale's default region, so a submission
 * naming another locale is rejected rather than read in the wrong region.
 */
export const preparePayStateInputSchema = (locale: Locale) =>
  Schema.Struct({
    ...preparePayStateCommonSchema.fields,
    locale: Schema.Literal(locale),
    reservation: reservationOrderIssuanceSchema(defaultPhoneRegion(locale)),
  }).check(marketingConsentSourceRequiresConsent);

export const preparePayStateSchema = (locale: Locale) =>
  Schema.toStandardSchemaV1(preparePayStateInputSchema(locale), {
    parseOptions: { onExcessProperty: "error" },
  });

export type PreparePayStateInput = StandardSchemaV1.InferOutput<
  ReturnType<typeof preparePayStateSchema>
>;
