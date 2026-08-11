import { Schema } from "effect";
import { normalizedOfficeReservationOrderSchema } from "@/features/reservation/office-reservation";
import { preparePayStateCommonSchema } from "./prepare-pay-state-common.schema";

export const prepareOfficePayStateInputSchema = Schema.Struct({
  ...preparePayStateCommonSchema.fields,
  reservation: normalizedOfficeReservationOrderSchema,
});

export type PrepareOfficePayStateInput =
  typeof prepareOfficePayStateInputSchema.Type;
