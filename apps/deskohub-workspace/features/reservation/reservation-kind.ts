import { Schema } from "effect";

export const coworkReservationKind = "cowork" as const;
export const meetingRoomReservationKind = "meeting-room" as const;

export const workspaceReservationKindSchema = Schema.Literals([
  coworkReservationKind,
  meetingRoomReservationKind,
]);

export type WorkspaceReservationKind =
  typeof workspaceReservationKindSchema.Type;
