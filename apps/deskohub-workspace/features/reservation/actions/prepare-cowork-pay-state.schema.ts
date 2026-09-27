import { Schema } from "effect";
import { normalizedSaleableCoworkReservationOrderSchema } from "@/features/reservation/cowork-reservation";
import { preparePayStateCommonSchema } from "./prepare-pay-state-common.schema";

export const prepareCoworkPayStateInputSchema = Schema.Struct({
  ...preparePayStateCommonSchema.fields,
  reservation: normalizedSaleableCoworkReservationOrderSchema,
});

export type PrepareCoworkPayStateInput =
  typeof prepareCoworkPayStateInputSchema.Type;
