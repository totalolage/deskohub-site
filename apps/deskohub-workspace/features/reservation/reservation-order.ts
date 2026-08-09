import { Schema } from "effect";
import { coworkReservationOrderSchema } from "@/features/reservation/cowork-reservation";
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
