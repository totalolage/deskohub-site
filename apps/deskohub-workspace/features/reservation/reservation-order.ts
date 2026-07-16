import { Match, Schema } from "effect";
import { coworkReservationOrderSchema } from "@/features/reservation/cowork-reservation";
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
]);

export type ReservationOrderInput = typeof reservationOrderSchema.Encoded;
export type ReservationOrderData = typeof reservationOrderSchema.Type;

type CoworkReservationProductInput = CoworkProductInput & {
  readonly _tag: "cowork";
};

export type ReservationProductProjectionInput =
  | CoworkReservationProductInput
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
