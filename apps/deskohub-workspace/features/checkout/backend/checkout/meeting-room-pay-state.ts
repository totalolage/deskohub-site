import {
  type MeetingRoomReservationQuote,
  meetingRoomReservationQuoteSchema,
} from "@/features/checkout/reservation-quote-meeting-room";
import {
  type NormalizedMeetingRoomReservationOrder,
  normalizedMeetingRoomReservationOrderSchema,
} from "@/features/reservation/meeting-room-reservation";
import {
  type BuildSignedReservationPayStateInput,
  buildSignedReservationPayState,
  makeSignedReservationPayStateSchema,
  type SignedPayStateClaims,
} from "./reservation-pay-state";

export const meetingRoomSignedPayStateSchema =
  makeSignedReservationPayStateSchema({
    reservation: normalizedMeetingRoomReservationOrderSchema,
    quote: meetingRoomReservationQuoteSchema,
  });

export type MeetingRoomSignedPayState =
  typeof meetingRoomSignedPayStateSchema.Type;

export type BuildSignedMeetingRoomPayStateInput =
  BuildSignedReservationPayStateInput<
    NormalizedMeetingRoomReservationOrder,
    MeetingRoomReservationQuote
  >;

export const buildSignedMeetingRoomPayState = (
  envelope: SignedPayStateClaims,
  input: BuildSignedMeetingRoomPayStateInput
): MeetingRoomSignedPayState =>
  buildSignedReservationPayState(
    envelope,
    input,
    input.quote.payment.expectedPrice,
    input.reservation
  );
