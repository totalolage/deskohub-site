import type { StandardSchemaV1 } from "@standard-schema/spec";
import { Schema } from "effect";
import { prepareCoworkPayStateInputSchema } from "./prepare-cowork-pay-state.schema";
import { prepareMeetingRoomPayStateInputSchema } from "./prepare-meeting-room-pay-state.schema";
import { prepareOfficePayStateInputSchema } from "./prepare-office-pay-state.schema";

export const preparePayStateSchema = Schema.toStandardSchemaV1(
  Schema.Union([
    prepareCoworkPayStateInputSchema,
    prepareMeetingRoomPayStateInputSchema,
    prepareOfficePayStateInputSchema,
  ]),
  { parseOptions: { onExcessProperty: "error" } }
);

export type PreparePayStateInput = StandardSchemaV1.InferOutput<
  typeof preparePayStateSchema
>;
