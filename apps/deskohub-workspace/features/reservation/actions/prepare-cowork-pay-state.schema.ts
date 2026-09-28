import { Schema } from "effect";
import { normalizedCurrentCoworkReservationOrderSchema } from "@/features/reservation/cowork-reservation";
import { preparePayStateCommonSchema } from "./prepare-pay-state-common.schema";

export const prepareCoworkPayStateInputSchema = Schema.Struct({
  ...preparePayStateCommonSchema.fields,
  reservation: normalizedCurrentCoworkReservationOrderSchema,
});

export type PrepareCoworkPayStateInput =
  typeof prepareCoworkPayStateInputSchema.Type;
