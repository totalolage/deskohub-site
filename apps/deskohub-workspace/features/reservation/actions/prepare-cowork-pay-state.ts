import { Effect } from "effect";
import {
  AdvertisedPriceMismatchError,
  CheckoutPricingService,
  getSubmittedCodeMetadata,
  openSubmittedAdvertisedPriceState,
  type PayStateSubmittedCodeMetadata,
} from "@/features/checkout/backend/checkout";
import type { CheckoutSummaryChangedKeys } from "@/features/checkout/checkout-summary";
import { getCheckoutSummaryChangedKeys } from "@/features/checkout/checkout-summary";
import { getCoworkCheckoutSummary } from "@/features/checkout/checkout-summary-cowork";
import type { CoworkReservationQuote } from "@/features/checkout/reservation-quote-cowork";
import type { CheckoutDetails } from "@/features/checkout/schemas/checkout-details";
import { getCoworkCheckoutDetails } from "@/features/checkout/schemas/checkout-details-cowork";
import type { AffirmedDiscountAdvertisementQuote } from "@/features/discounts";
import type { CanonicalPromotionCode } from "@/features/discounts/contracts";
import type { Locale } from "@/features/i18n";
import type { WorkspaceAvailabilityService } from "@/features/reservation/backend/workspace-availability.service";
import {
  type CoworkReservationDetails,
  coworkAdvertisedPriceReservationEquals,
  getCoworkAdvertisedPriceReservation,
  type NormalizedCoworkReservationOrder,
} from "@/features/reservation/cowork-reservation";
import type { PrepareCoworkPayStateInput } from "./prepare-cowork-pay-state.schema";

export type PreparedCoworkAdvertisement = PayStateSubmittedCodeMetadata & {
  readonly kind: "cowork";
  readonly reservation: NormalizedCoworkReservationOrder;
  readonly advertisedQuote: CoworkReservationQuote;
  readonly discountQuote: AffirmedDiscountAdvertisementQuote;
  readonly changedKeys?: CheckoutSummaryChangedKeys;
  readonly requestedDiscountCode?: CanonicalPromotionCode;
};

export type PreparedCoworkPayState = PayStateSubmittedCodeMetadata & {
  readonly kind: "cowork";
  readonly reservation: NormalizedCoworkReservationOrder;
  readonly quote: CoworkReservationQuote;
  readonly requestedDiscountCode?: CanonicalPromotionCode;
};

export const prepareCoworkAdvertisement = Effect.fn(
  "prepareCoworkPayState.prepareAdvertisement"
)(function* (input: PrepareCoworkPayStateInput) {
  const state = yield* openSubmittedAdvertisedPriceState(
    input.advertisedPriceToken
  );
  const expectedReservation = getCoworkAdvertisedPriceReservation(
    input.reservation
  );

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
  const affirmed = yield* pricing.affirmCoworkAdvertisement({
    reservation: state.reservation,
    locale: input.locale,
    advertisedQuote: state.quote,
    ...getSubmittedCodeMetadata(state),
  });
  const changed = state.quote.fingerprint !== affirmed.quote.fingerprint;

  return {
    kind: input.reservation.kind,
    reservation: input.reservation,
    advertisedQuote: state.quote,
    discountQuote: affirmed.discountQuote,
    ...getSubmittedCodeMetadata(affirmed),
    // Requested intent travels separately from the applied pair above; a
    // customer quote that drops the applied metadata keeps the request.
    requestedDiscountCode: state.requestedDiscountCode ?? state.submittedCode,
    ...(changed && {
      changedKeys: getCheckoutSummaryChangedKeys(
        getCoworkCheckoutSummary(state.reservation.details, state.quote),
        getCoworkCheckoutSummary(affirmed.reservation.details, affirmed.quote)
      ),
    }),
  };
});

export const ensureCoworkPayStateAvailable = (input: {
  readonly availability: typeof WorkspaceAvailabilityService.Service;
  readonly reservation: Pick<
    CoworkReservationDetails,
    "kind" | "date" | "entryTier" | "monitorOption"
  >;
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
