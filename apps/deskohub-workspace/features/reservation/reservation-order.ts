import { Schema } from "effect";
import {
  coworkReservationOrderSchema,
  coworkSaleableReservationOrderSchema,
} from "@/features/reservation/cowork-reservation";
import { meetingRoomReservationOrderSchema } from "@/features/reservation/meeting-room-reservation";
import { officeReservationOrderSchema } from "@/features/reservation/office-reservation";

export const reservationOrderSchema = Schema.Union([
  coworkReservationOrderSchema,
  meetingRoomReservationOrderSchema,
  officeReservationOrderSchema,
]).annotate({
  identifier: "ReservationOrder",
  description: "Validated cowork or meeting-room reservation order.",
});

export type ReservationOrderInput = typeof reservationOrderSchema.Encoded;
export type ReservationOrderData = typeof reservationOrderSchema.Type;

// Public issuance only ever produces the saleable cowork offers while the
// full order union above stays decodable for historical truth.
export const reservationOrderIssuanceSchema = Schema.Union([
  coworkSaleableReservationOrderSchema,
  meetingRoomReservationOrderSchema,
  officeReservationOrderSchema,
]).annotate({
  identifier: "ReservationOrderIssuance",
  description: "Publicly issuable reservation order.",
});

export type ReservationOrderIssuanceData =
  typeof reservationOrderIssuanceSchema.Type;
