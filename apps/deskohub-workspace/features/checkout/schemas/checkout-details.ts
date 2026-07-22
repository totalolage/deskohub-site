import { Match, Schema } from "effect";
import { coworkCheckoutDetailsJsonSchema } from "@/features/checkout/schemas/checkout-details-cowork";
import { meetingRoomCheckoutDetailsJsonSchema } from "@/features/checkout/schemas/checkout-details-meeting-room";
import {
  coworkReservationDetailsSchema,
  getCoworkReservationDetails,
} from "@/features/reservation/cowork-reservation";
import {
  getMeetingRoomReservationDetails,
  meetingRoomReservationDetailsSchema,
} from "@/features/reservation/meeting-room-reservation";
import type { ReservationOrderData } from "@/features/reservation/reservation-order";

export const checkoutReservationDetailsSchema = Schema.Union([
  coworkReservationDetailsSchema,
  meetingRoomReservationDetailsSchema,
]).annotate({
  identifier: "CheckoutReservationDetails",
  description: "PII-free reservation projection used by checkout providers.",
});

export type CheckoutReservationDetails =
  typeof checkoutReservationDetailsSchema.Type;

export const getCheckoutReservationDetails = (
  reservation: ReservationOrderData
): CheckoutReservationDetails =>
  Match.value(reservation).pipe(
    Match.discriminatorsExhaustive("kind")({
      cowork: getCoworkReservationDetails,
      "meeting-room": getMeetingRoomReservationDetails,
    })
  );

export const checkoutDetailsJsonSchema = Schema.Union([
  coworkCheckoutDetailsJsonSchema,
  meetingRoomCheckoutDetailsJsonSchema,
]).annotate({
  identifier: "CheckoutDetails",
  description: "Transient PII-free checkout provider snapshot.",
});

export type CheckoutDetailsJson = typeof checkoutDetailsJsonSchema.Type;
