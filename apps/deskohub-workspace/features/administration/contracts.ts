import {
  AdministrationReservationCancellationInput,
  AdministrationWorkspaceReservationId,
} from "@deskohub/workspace-admin-api";
import { Schema } from "effect";

export const reservationCancellationSchema = Schema.Struct({
  reservationId: AdministrationWorkspaceReservationId,
  ...AdministrationReservationCancellationInput.fields,
});

export const reservationCancellationStandardSchema = Schema.toStandardSchemaV1(
  reservationCancellationSchema
);

export type ReservationCancellationInput =
  typeof reservationCancellationSchema.Type;

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
