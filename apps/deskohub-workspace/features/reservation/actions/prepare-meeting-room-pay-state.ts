import { buildSignedPayState } from "@/features/checkout/backend/checkout";
import type { CheckoutSummaryChangedKeys } from "@/features/checkout/checkout-quote";
import type { MeetingRoomReservationQuote } from "@/features/checkout/reservation-quote-meeting-room";
import type { CheckoutDetailsJson } from "@/features/checkout/schemas/checkout-details";
import { getMeetingRoomCheckoutDetails } from "@/features/checkout/schemas/checkout-details-meeting-room";
import type { Locale } from "@/features/i18n";
import type { WorkspaceAvailabilityService } from "@/features/reservation/backend/workspace-availability.service";
import type { NormalizedMeetingRoomReservationOrder } from "@/features/reservation/meeting-room-reservation";

export type PreparedMeetingRoomPayState = {
  readonly kind: "meeting-room";
  readonly reservation: NormalizedMeetingRoomReservationOrder;
  readonly quote: MeetingRoomReservationQuote;
};

export const ensureMeetingRoomPayStateAvailable = (input: {
  readonly availability: typeof WorkspaceAvailabilityService.Service;
  readonly reservation: NormalizedMeetingRoomReservationOrder;
}) =>
  input.availability.ensureAvailable({
    kind: input.reservation.kind,
    startsAt: input.reservation.startsAt,
    endsAt: input.reservation.endsAt,
  });

export const getPreparedMeetingRoomCheckoutDetails = (input: {
  readonly locale: Locale;
  readonly prepared: PreparedMeetingRoomPayState;
  readonly legalEvidence: CheckoutDetailsJson["legal"];
}): CheckoutDetailsJson =>
  getMeetingRoomCheckoutDetails({
    locale: input.locale,
    reservation: input.prepared.reservation,
    quote: input.prepared.quote,
    legalEvidence: input.legalEvidence,
  });

export const buildPreparedMeetingRoomPayState = (input: {
  readonly locale: Locale;
  readonly prepared: PreparedMeetingRoomPayState;
  readonly reservationId: string;
  readonly checkoutSessionId: string;
  readonly changedKeys?: CheckoutSummaryChangedKeys;
}) =>
  buildSignedPayState({
    locale: input.locale,
    reservation: input.prepared.reservation,
    quote: input.prepared.quote,
    orderId: input.reservationId,
    checkoutSessionId: input.checkoutSessionId,
    changedKeys: input.changedKeys,
  });
