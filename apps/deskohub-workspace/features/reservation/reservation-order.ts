import { Match, Schema } from "effect";
import {
  type CoworkReservationProductInput,
  coworkReservationOrderEffectSchema,
  getCoworkReservationProductCoffee,
  getCoworkReservationProductMonitorOption,
} from "@/features/reservation/cowork-reservation";
import {
  getMeetingRoomReservationProductCoffee,
  getMeetingRoomReservationProductMonitorOption,
  type MeetingRoomReservationProductInput,
  meetingRoomReservationOrderEffectSchema,
} from "@/features/reservation/meeting-room-reservation";

export const reservationOrderEffectSchema = Schema.Union([
  coworkReservationOrderEffectSchema,
  meetingRoomReservationOrderEffectSchema,
]);

export type ReservationOrderInput = typeof reservationOrderEffectSchema.Encoded;
export type ReservationOrderData = typeof reservationOrderEffectSchema.Type;

export type ReservationProductProjectionInput =
  | CoworkReservationProductInput
  | MeetingRoomReservationProductInput;

export const getReservationProductCoffee = (
  reservation: ReservationProductProjectionInput
) =>
  Match.value(reservation).pipe(
    Match.when({ _tag: "cowork" }, getCoworkReservationProductCoffee),
    Match.when(
      { _tag: "meeting-room" },
      getMeetingRoomReservationProductCoffee
    ),
    Match.exhaustive
  );

export const getReservationProductMonitorOption = (
  reservation: ReservationProductProjectionInput
) =>
  Match.value(reservation).pipe(
    Match.when({ _tag: "cowork" }, getCoworkReservationProductMonitorOption),
    Match.when(
      { _tag: "meeting-room" },
      getMeetingRoomReservationProductMonitorOption
    ),
    Match.exhaustive
  );
