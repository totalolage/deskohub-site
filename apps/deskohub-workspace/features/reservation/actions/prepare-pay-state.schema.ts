import type { StandardSchemaV1 } from "@standard-schema/spec";
import { Schema } from "effect";
import { reservationOrderIssuanceSchema } from "@/features/reservation/reservation-order";
import { preparePayStateCommonSchema } from "./prepare-pay-state-common.schema";

export const preparePayStateSchema = Schema.toStandardSchemaV1(
  Schema.Struct({
    ...preparePayStateCommonSchema.fields,
    reservation: reservationOrderIssuanceSchema,
  }),
  { parseOptions: { onExcessProperty: "error" } }
);

export type PreparePayStateInput = StandardSchemaV1.InferOutput<
  typeof preparePayStateSchema
>;
