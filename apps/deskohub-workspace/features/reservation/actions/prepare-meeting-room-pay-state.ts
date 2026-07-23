import { Effect } from "effect";
import {
  AdvertisedPriceMismatchError,
  CheckoutPricingService,
  openSubmittedAdvertisedPriceState,
} from "@/features/checkout/backend/checkout";
import {
  type CheckoutSummaryChangedKeys,
  getCheckoutSummaryChangedKeys,
} from "@/features/checkout/checkout-quote";
import {
  getMeetingRoomCheckoutSummary,
  type MeetingRoomReservationQuote,
} from "@/features/checkout/reservation-quote-meeting-room";
import type { CheckoutDetailsJson } from "@/features/checkout/schemas/checkout-details";
import { getMeetingRoomCheckoutDetails } from "@/features/checkout/schemas/checkout-details-meeting-room";
import type { AffirmedDiscountAdvertisementQuote } from "@/features/discounts";
import type { Locale } from "@/features/i18n";
import type { WorkspaceAvailabilityService } from "@/features/reservation/backend/workspace-availability.service";
import {
  getMeetingRoomAdvertisedPriceReservation,
  meetingRoomAdvertisedPriceReservationEquals,
  type NormalizedMeetingRoomReservationOrder,
} from "@/features/reservation/meeting-room-reservation";
import type { PrepareMeetingRoomPayStateInput } from "./prepare-meeting-room-pay-state.schema";

export type PreparedMeetingRoomAdvertisement = {
  readonly kind: "meeting-room";
  readonly reservation: NormalizedMeetingRoomReservationOrder;
  readonly discountQuote: AffirmedDiscountAdvertisementQuote;
  readonly changedKeys?: CheckoutSummaryChangedKeys;
};

export type PreparedMeetingRoomPayState = {
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

  const pricing = yield* CheckoutPricingService;
  const affirmed = yield* pricing.affirmAdvertisement({
    reservation: state.reservation,
    locale: input.locale,
    advertisedQuote: state.quote,
  });
  if (affirmed.kind !== "meeting-room") {
    return yield* Effect.die(
      "Meeting-room advertisement affirmation returned another reservation family."
    );
  }
  const changed = state.quote.fingerprint !== affirmed.quote.fingerprint;

  return {
    kind: input.reservation.kind,
    reservation: input.reservation,
    discountQuote: affirmed.discountQuote,
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
