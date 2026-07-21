import { Schema } from "effect";
import { storedCoworkReservationDetailsSchema } from "@/features/reservation/cowork-reservation-product";
import { storedMeetingRoomReservationDetailsSchema } from "@/features/reservation/meeting-room-reservation";

export const storedWorkspaceReservationDetailsSchema = Schema.Union([
  storedCoworkReservationDetailsSchema,
  storedMeetingRoomReservationDetailsSchema,
]).annotate({
  identifier: "StoredWorkspaceReservationDetails",
  description:
    "App-owned product intent persisted for a Workspace reservation.",
});

export type StoredWorkspaceReservationDetails =
  typeof storedWorkspaceReservationDetailsSchema.Type;

export const workspaceReservationIdSchema = Schema.NonEmptyString.pipe(
  Schema.brand("WorkspaceReservationId")
).annotate({
  identifier: "WorkspaceReservationId",
  description: "Opaque identifier for a persisted workspace reservation.",
});

export type WorkspaceReservationId = Schema.Schema.Type<
  typeof workspaceReservationIdSchema
>;
