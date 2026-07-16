import { Match, Schema } from "effect";
import {
  type CoworkReservationProductInput,
  coworkReservationOrderSchema,
  getCoworkReservationProductCoffee,
  getCoworkReservationProductMonitorOption,
} from "@/features/reservation/cowork-reservation";
import {
  getMeetingRoomReservationProductCoffee,
  getMeetingRoomReservationProductMonitorOption,
  type MeetingRoomReservationProductInput,
  meetingRoomReservationOrderSchema,
} from "@/features/reservation/meeting-room-reservation";

export const reservationOrderSchema = Schema.Union([
  coworkReservationOrderSchema,
  meetingRoomReservationOrderSchema,
]);

export type ReservationOrderInput = typeof reservationOrderSchema.Encoded;
export type ReservationOrderData = typeof reservationOrderSchema.Type;

export type ReservationProductProjectionInput =
  | CoworkReservationProductInput
  | MeetingRoomReservationProductInput;

export const getReservationProductCoffee = (
  reservation: ReservationProductProjectionInput
) =>
  Match.value(reservation).pipe(
    Match.tag("cowork", getCoworkReservationProductCoffee),
    Match.tag("meeting-room", getMeetingRoomReservationProductCoffee),
    Match.exhaustive
  );

export const getReservationProductMonitorOption = (
  reservation: ReservationProductProjectionInput
) =>
  Match.value(reservation).pipe(
    Match.tag("cowork", getCoworkReservationProductMonitorOption),
    Match.tag("meeting-room", getMeetingRoomReservationProductMonitorOption),
    Match.exhaustive
  );
