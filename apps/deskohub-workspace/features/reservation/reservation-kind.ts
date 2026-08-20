import { Schema } from "effect";

export const coworkReservationKind = "cowork" as const;
export const meetingRoomReservationKind = "meeting-room" as const;
export const officeReservationKind = "office" as const;

export const workspaceReservationKindSchema = Schema.Literals([
  coworkReservationKind,
  meetingRoomReservationKind,
  officeReservationKind,
]);

export type WorkspaceReservationKind =
  typeof workspaceReservationKindSchema.Type;
