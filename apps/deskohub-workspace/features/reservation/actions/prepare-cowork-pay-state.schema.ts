import { Schema } from "effect";
import { normalizedCoworkReservationOrderSchema } from "@/features/reservation/cowork-reservation";
import { preparePayStateCommonSchema } from "./prepare-pay-state-common.schema";

export const prepareCoworkPayStateInputSchema = Schema.Struct({
  ...preparePayStateCommonSchema.fields,
  advertisedPriceToken: Schema.NonEmptyString,
  reservation: normalizedCoworkReservationOrderSchema,
});

export type PrepareCoworkPayStateInput =
  typeof prepareCoworkPayStateInputSchema.Type;
