import { Match, Schema } from "effect";
import {
  type CoworkReservationOrderInput,
  coworkReservationOrderSchema,
} from "@/features/reservation/cowork-reservation";
import {
  type CoworkReservationProductInput as CoworkProductInput,
  getCoworkReservationProductCoffee,
  getCoworkReservationProductMonitorOption,
} from "@/features/reservation/cowork-reservation-product";
import {
  getMeetingRoomReservationProductCoffee,
  getMeetingRoomReservationProductMonitorOption,
  type MeetingRoomReservationProductInput,
  meetingRoomReservationOrderSchema,
} from "@/features/reservation/meeting-room-reservation";

export const reservationOrderSchema = Schema.Union([
  coworkReservationOrderSchema,
  meetingRoomReservationOrderSchema,
]).annotate({
  identifier: "ReservationOrder",
  description: "Validated cowork or meeting-room reservation order.",
});

export type ReservationOrderInput = typeof reservationOrderSchema.Encoded;
export type ReservationOrderData = typeof reservationOrderSchema.Type;

export type ReservationProductProjectionInput =
  | (CoworkProductInput & Pick<CoworkReservationOrderInput, "kind">)
  | MeetingRoomReservationProductInput;

export const getReservationProductCoffee = (
  reservation: ReservationProductProjectionInput
) =>
  Match.value(reservation).pipe(
    Match.discriminatorsExhaustive("kind")({
      cowork: getCoworkReservationProductCoffee,
      "meeting-room": getMeetingRoomReservationProductCoffee,
    })
  );

export const getReservationProductMonitorOption = (
  reservation: ReservationProductProjectionInput
) =>
  Match.value(reservation).pipe(
    Match.discriminatorsExhaustive("kind")({
      cowork: getCoworkReservationProductMonitorOption,
      "meeting-room": getMeetingRoomReservationProductMonitorOption,
    })
  );
