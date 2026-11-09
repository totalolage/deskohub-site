import { Schema } from "effect";
import {
  coworkCurrentReservationOrderSchema,
  coworkReservationOrderSchema,
} from "@/features/reservation/cowork-reservation";
import { meetingRoomReservationOrderSchema } from "@/features/reservation/meeting-room-reservation";
import { officeReservationOrderSchema } from "@/features/reservation/office-reservation";

/** A reservation order a customer submits, phone read in `defaultPhoneRegion`. */
export const reservationOrderSchema = (defaultPhoneRegion: string) =>
  Schema.Union([
    coworkReservationOrderSchema(defaultPhoneRegion),
    meetingRoomReservationOrderSchema(defaultPhoneRegion),
    officeReservationOrderSchema(defaultPhoneRegion),
  ]).annotate({
    identifier: "ReservationOrder",
    description: "Validated cowork or meeting-room reservation order.",
  });

export type ReservationOrderData = ReturnType<
  typeof reservationOrderSchema
>["Type"];

/**
 * An order a customer can issue now, phone read in `defaultPhoneRegion`.
 * Public issuance only ever produces the current cowork offers while the full
 * order union above stays decodable for historical truth.
 */
export const reservationOrderIssuanceSchema = (defaultPhoneRegion: string) =>
  Schema.Union([
    coworkCurrentReservationOrderSchema(defaultPhoneRegion),
    meetingRoomReservationOrderSchema(defaultPhoneRegion),
    officeReservationOrderSchema(defaultPhoneRegion),
  ]).annotate({
    identifier: "ReservationOrderIssuance",
    description: "Publicly issuable reservation order.",
  });

export type ReservationOrderIssuanceData = ReturnType<
  typeof reservationOrderIssuanceSchema
>["Type"];
