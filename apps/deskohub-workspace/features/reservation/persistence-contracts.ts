import { Match, Schema } from "effect";
import {
  getStoredCoworkReservationDetails,
  storedCoworkReservationDetailsSchema,
} from "@/features/reservation/cowork-reservation-product";
import {
  getStoredMeetingRoomReservationDetails,
  storedMeetingRoomReservationDetailsSchema,
} from "@/features/reservation/meeting-room-reservation";
import {
  getStoredOfficeReservationDetails,
  storedOfficeReservationDetailsSchema,
} from "@/features/reservation/office-reservation";
import type { ReservationOrderData } from "@/features/reservation/reservation-order";

export const storedWorkspaceReservationDetailsSchema = Schema.Union([
  storedCoworkReservationDetailsSchema,
  storedMeetingRoomReservationDetailsSchema,
  storedOfficeReservationDetailsSchema,
]).annotate({
  identifier: "StoredWorkspaceReservationDetails",
  description:
    "App-owned reservation-family details persisted without provider-owned facts.",
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
      office: getStoredOfficeReservationDetails,
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
