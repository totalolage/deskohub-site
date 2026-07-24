import { Schema } from "effect";
import {
  type BuildSignedPayStateCommonInput,
  buildSignedPayStateEnvelope,
  type SignedPayStateEnvelope,
  signedPayStateEnvelopeSchema,
} from "@/features/checkout/backend/checkout/pay-state-contract";
import {
  type MeetingRoomReservationQuote,
  meetingRoomReservationQuoteSchema,
} from "@/features/checkout/reservation-quote-meeting-room";
import {
  type NormalizedMeetingRoomReservationOrder,
  normalizedMeetingRoomReservationOrderSchema,
} from "@/features/reservation/meeting-room-reservation";

export const meetingRoomSignedPayStateSchema = Schema.Struct({
  ...signedPayStateEnvelopeSchema.fields,
  reservation: normalizedMeetingRoomReservationOrderSchema,
  quote: meetingRoomReservationQuoteSchema,
});

export type MeetingRoomSignedPayState =
  typeof meetingRoomSignedPayStateSchema.Type;

export type BuildSignedMeetingRoomPayStateInput =
  BuildSignedPayStateCommonInput & {
    readonly reservation: NormalizedMeetingRoomReservationOrder;
    readonly quote: MeetingRoomReservationQuote;
  };

export const buildSignedMeetingRoomPayState = (
  envelope: Omit<
    SignedPayStateEnvelope,
    | "acceptedTotal"
    | "checkoutSessionId"
    | "submittedCode"
    | "submittedCodeDiscountId"
    | "changedKeys"
  >,
  input: BuildSignedMeetingRoomPayStateInput
): MeetingRoomSignedPayState => ({
  ...buildSignedPayStateEnvelope(
    envelope,
    input,
    input.quote.payment.expectedPrice
  ),
  reservation: input.reservation,
  quote: {
    items: [...input.quote.items],
    fingerprint: input.quote.fingerprint,
    payment: {
      ...input.quote.payment,
      discounts: [...input.quote.payment.discounts],
    },
  },
});
