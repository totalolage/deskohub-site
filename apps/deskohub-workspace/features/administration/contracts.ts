import { Schema } from "effect";

export const reservationLookupSchema = Schema.Struct({
  identifier: Schema.Trim.check(Schema.isNonEmpty(), Schema.isMaxLength(256)),
});

export const reservationLookupStandardSchema = Schema.toStandardSchemaV1(
  reservationLookupSchema,
  {
    parseOptions: {
      errors: "all",
      onExcessProperty: "error",
    },
  }
);

export type ReservationLookupInput = typeof reservationLookupSchema.Type;
