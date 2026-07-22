import { Match, Schema } from "effect";
import {
  getStoredCoworkReservationDetails,
  storedCoworkReservationDetailsSchema,
} from "@/features/reservation/cowork-reservation-product";
import {
  getStoredMeetingRoomReservationDetails,
  storedMeetingRoomReservationDetailsSchema,
} from "@/features/reservation/meeting-room-reservation";
import type { ReservationOrderData } from "@/features/reservation/reservation-order";

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

export const getStoredWorkspaceReservationDetails = (
  reservation: ReservationOrderData
): StoredWorkspaceReservationDetails =>
  Match.value(reservation).pipe(
    Match.discriminatorsExhaustive("kind")({
      cowork: getStoredCoworkReservationDetails,
      "meeting-room": getStoredMeetingRoomReservationDetails,
    })
  );

export const workspaceReservationIdSchema = Schema.NonEmptyString.pipe(
  Schema.brand("WorkspaceReservationId")
).annotate({
  identifier: "WorkspaceReservationId",
  description: "Opaque identifier for a persisted workspace reservation.",
});

export type WorkspaceReservationId = Schema.Schema.Type<
  typeof workspaceReservationIdSchema
>;
