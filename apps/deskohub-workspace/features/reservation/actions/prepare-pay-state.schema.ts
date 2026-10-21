import type { StandardSchemaV1 } from "@standard-schema/spec";
import { Schema } from "effect";
import { reservationOrderIssuanceSchema } from "@/features/reservation/reservation-order";
import {
  marketingConsentSourceRequiresConsent,
  preparePayStateCommonSchema,
} from "./prepare-pay-state-common.schema";

/** One reservation submission the booking operation prepares Pay for. */
export const preparePayStateInputSchema = Schema.Struct({
  ...preparePayStateCommonSchema.fields,
  reservation: reservationOrderIssuanceSchema,
}).check(marketingConsentSourceRequiresConsent);

export const preparePayStateSchema = Schema.toStandardSchemaV1(
  preparePayStateInputSchema,
  { parseOptions: { onExcessProperty: "error" } }
);

export type PreparePayStateInput = StandardSchemaV1.InferOutput<
  typeof preparePayStateSchema
>;
