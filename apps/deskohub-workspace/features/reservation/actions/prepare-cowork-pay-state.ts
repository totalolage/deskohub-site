import { Effect } from "effect";
import {
  AdvertisedPriceMismatchError,
  CheckoutPricingService,
  openSubmittedAdvertisedPriceState,
} from "@/features/checkout/backend/checkout";
import type {
  CheckoutSummaryChangedKeys,
  CoworkReservationQuote,
} from "@/features/checkout/checkout-quote";
import { getCheckoutSummaryChangedKeys } from "@/features/checkout/checkout-quote";
import type { CheckoutDetails } from "@/features/checkout/schemas/checkout-details";
import { getCoworkCheckoutDetails } from "@/features/checkout/schemas/checkout-details-cowork";
import type { AffirmedDiscountAdvertisementQuote } from "@/features/discounts";
import type { Locale } from "@/features/i18n";
import type { WorkspaceAvailabilityService } from "@/features/reservation/backend/workspace-availability.service";
import {
  coworkAdvertisedPriceReservationEquals,
  getCoworkReservationDetails,
  type NormalizedCoworkReservationOrder,
} from "@/features/reservation/cowork-reservation";
import type { PrepareCoworkPayStateInput } from "./prepare-cowork-pay-state.schema";

export type PreparedCoworkAdvertisement = {
  readonly kind: "cowork";
  readonly reservation: NormalizedCoworkReservationOrder;
  readonly discountQuote: AffirmedDiscountAdvertisementQuote;
  readonly changedKeys?: CheckoutSummaryChangedKeys;
};

export type PreparedCoworkPayState = {
  readonly kind: "cowork";
  readonly reservation: NormalizedCoworkReservationOrder;
  readonly quote: CoworkReservationQuote;
};

export const prepareCoworkAdvertisement = Effect.fn(
  "prepareCoworkPayState.prepareAdvertisement"
)(function* (input: PrepareCoworkPayStateInput) {
  const state = yield* openSubmittedAdvertisedPriceState(
    input.advertisedPriceToken
  );
  const expectedReservation = {
    kind: input.reservation.kind,
    details: getCoworkReservationDetails(input.reservation),
  } as const;

  if (state.kind !== "cowork") {
    return yield* new AdvertisedPriceMismatchError({
      reason: "input_mismatch",
      message:
        "Advertised price snapshot does not match the submitted reservation.",
    });
  }

  if (
    state.locale !== input.locale ||
    !coworkAdvertisedPriceReservationEquals(
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
  if (affirmed.kind !== "cowork") {
    return yield* Effect.die(
      "Cowork advertisement affirmation returned another reservation family."
    );
  }
  const changed = state.quote.fingerprint !== affirmed.quote.fingerprint;

  return {
    kind: input.reservation.kind,
    reservation: input.reservation,
    discountQuote: affirmed.discountQuote,
    ...(changed && {
      changedKeys: getCheckoutSummaryChangedKeys(
        state.quote.summary,
        affirmed.quote.summary
      ),
    }),
  };
});

export const ensureCoworkPayStateAvailable = (input: {
  readonly availability: typeof WorkspaceAvailabilityService.Service;
  readonly reservation: NormalizedCoworkReservationOrder;
}) =>
  input.availability.ensureAvailable({
    kind: input.reservation.kind,
    date: input.reservation.date,
    entryTier: input.reservation.entryTier,
    monitorOption: input.reservation.monitorOption,
  });

export const getPreparedCoworkCheckoutDetails = (input: {
  readonly locale: Locale;
  readonly prepared: PreparedCoworkPayState;
  readonly legalEvidence: CheckoutDetails["legal"];
}): CheckoutDetails =>
  getCoworkCheckoutDetails({
    locale: input.locale,
    reservation: input.prepared.reservation,
    quote: input.prepared.quote,
    legalEvidence: input.legalEvidence,
  });
