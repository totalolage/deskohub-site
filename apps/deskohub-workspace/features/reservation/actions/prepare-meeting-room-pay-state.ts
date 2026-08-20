import { Effect } from "effect";
import {
  AdvertisedPriceMismatchError,
  CheckoutPricingService,
  getSubmittedCodeMetadata,
  openSubmittedAdvertisedPriceState,
  type PayStateSubmittedCodeMetadata,
} from "@/features/checkout/backend/checkout";
import {
  type CheckoutSummaryChangedKeys,
  getCheckoutSummaryChangedKeys,
} from "@/features/checkout/checkout-summary";
import { getMeetingRoomCheckoutSummary } from "@/features/checkout/checkout-summary-meeting-room";
import type { MeetingRoomReservationQuote } from "@/features/checkout/reservation-quote-meeting-room";
import type { CheckoutDetails } from "@/features/checkout/schemas/checkout-details";
import { getMeetingRoomCheckoutDetails } from "@/features/checkout/schemas/checkout-details-meeting-room";
import type { AffirmedDiscountAdvertisementQuote } from "@/features/discounts";
import type { Locale } from "@/features/i18n";
import type { WorkspaceAvailabilityService } from "@/features/reservation/backend/workspace-availability.service";
import {
  getMeetingRoomAdvertisedPriceReservation,
  type MeetingRoomReservationDetails,
  meetingRoomAdvertisedPriceReservationEquals,
  type NormalizedMeetingRoomReservationOrder,
} from "@/features/reservation/meeting-room-reservation";
import type { PrepareMeetingRoomPayStateInput } from "./prepare-meeting-room-pay-state.schema";

export type PreparedMeetingRoomAdvertisement = PayStateSubmittedCodeMetadata & {
  readonly kind: "meeting-room";
  readonly reservation: NormalizedMeetingRoomReservationOrder;
  readonly advertisedQuote: MeetingRoomReservationQuote;
  readonly discountQuote: AffirmedDiscountAdvertisementQuote;
  readonly changedKeys?: CheckoutSummaryChangedKeys;
};

export type PreparedMeetingRoomPayState = PayStateSubmittedCodeMetadata & {
  readonly kind: "meeting-room";
  readonly reservation: NormalizedMeetingRoomReservationOrder;
  readonly quote: MeetingRoomReservationQuote;
};

export const prepareMeetingRoomAdvertisement = Effect.fn(
  "prepareMeetingRoomPayState.prepareAdvertisement"
)(function* (input: PrepareMeetingRoomPayStateInput) {
  const state = yield* openSubmittedAdvertisedPriceState(
    input.advertisedPriceToken
  );
  const expectedReservation = getMeetingRoomAdvertisedPriceReservation(
    input.reservation
  );

  if (state.kind !== "meeting-room") {
    return yield* new AdvertisedPriceMismatchError({
      reason: "input_mismatch",
      message:
        "Advertised price snapshot does not match the submitted reservation.",
    });
  }

  if (
    state.locale !== input.locale ||
    !meetingRoomAdvertisedPriceReservationEquals(
      state.reservation,
      expectedReservation
    )
  ) {
    return yield* new AdvertisedPriceMismatchError({
      reason: "input_mismatch",
      message:
        "Advertised price snapshot does not match the submitted reservation.",
    });
  }

  const reservation = input.reservation;
  const pricing = yield* CheckoutPricingService;
  const affirmed = yield* pricing.affirmMeetingRoomAdvertisement({
    reservation: getMeetingRoomAdvertisedPriceReservation(reservation),
    locale: input.locale,
    advertisedQuote: state.quote,
    ...getSubmittedCodeMetadata(state),
  });
  const changed = state.quote.fingerprint !== affirmed.quote.fingerprint;

  return {
    kind: input.reservation.kind,
    reservation,
    advertisedQuote: state.quote,
    discountQuote: affirmed.discountQuote,
    ...getSubmittedCodeMetadata(affirmed),
    ...(changed && {
      changedKeys: getCheckoutSummaryChangedKeys(
        getMeetingRoomCheckoutSummary(state.quote),
        getMeetingRoomCheckoutSummary(affirmed.quote)
      ),
    }),
  };
});

export const ensureMeetingRoomPayStateAvailable = (input: {
  readonly availability: typeof WorkspaceAvailabilityService.Service;
  readonly reservation: Pick<
    MeetingRoomReservationDetails,
    "kind" | "startsAt" | "endsAt"
  >;
}) =>
  input.availability.ensureAvailable({
    kind: input.reservation.kind,
    startsAt: input.reservation.startsAt,
    endsAt: input.reservation.endsAt,
  });

export const getPreparedMeetingRoomCheckoutDetails = (input: {
  readonly locale: Locale;
  readonly prepared: PreparedMeetingRoomPayState;
  readonly legalEvidence: CheckoutDetails["legal"];
}): CheckoutDetails =>
  getMeetingRoomCheckoutDetails({
    locale: input.locale,
    reservation: input.prepared.reservation,
    quote: input.prepared.quote,
    legalEvidence: input.legalEvidence,
  });
