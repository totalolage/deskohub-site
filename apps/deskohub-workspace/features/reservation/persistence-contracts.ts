import { Schema } from "effect";

export const workspaceReservationIdSchema = Schema.NonEmptyString.pipe(
  Schema.brand("WorkspaceReservationId")
).annotate({
  identifier: "WorkspaceReservationId",
  description: "Opaque identifier for a persisted workspace reservation.",
});

export type WorkspaceReservationId = Schema.Schema.Type<
  typeof workspaceReservationIdSchema
>;
