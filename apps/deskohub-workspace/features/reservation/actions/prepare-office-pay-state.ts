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
import { getOfficeCheckoutSummary } from "@/features/checkout/checkout-summary-office";
import type { OfficeReservationQuote } from "@/features/checkout/reservation-quote-office";
import type { CheckoutDetails } from "@/features/checkout/schemas/checkout-details";
import { getOfficeCheckoutDetails } from "@/features/checkout/schemas/checkout-details-office";
import type { AffirmedDiscountAdvertisementQuote } from "@/features/discounts";
import type { Locale } from "@/features/i18n";
import type { WorkspaceAvailabilityService } from "@/features/reservation/backend/workspace-availability.service";
import {
  getOfficeAdvertisedPriceReservation,
  getOfficeReservationIntervalInput,
  type NormalizedOfficeReservationOrder,
  type OfficeReservationDetails,
  officeAdvertisedPriceReservationEquals,
} from "@/features/reservation/office-reservation";
import { normalizeReservationIntervalFields } from "@/features/reservation/reservation-interval-normalization";
import { workspaceSiteConstants } from "@/shared/utils/site-constants";
import type { PrepareOfficePayStateInput } from "./prepare-office-pay-state.schema";

export type PreparedOfficeAdvertisement = PayStateSubmittedCodeMetadata & {
  readonly kind: "office";
  readonly reservation: NormalizedOfficeReservationOrder;
  readonly advertisedQuote: OfficeReservationQuote;
  readonly discountQuote: AffirmedDiscountAdvertisementQuote;
  readonly changedKeys?: CheckoutSummaryChangedKeys;
};

export type PreparedOfficePayState = PayStateSubmittedCodeMetadata & {
  readonly kind: "office";
  readonly reservation: NormalizedOfficeReservationOrder;
  readonly quote: OfficeReservationQuote;
};

export const prepareOfficeAdvertisement = Effect.fn(
  "prepareOfficePayState.prepareAdvertisement"
)(function* (input: PrepareOfficePayStateInput) {
  const state = yield* openSubmittedAdvertisedPriceState(
    input.advertisedPriceToken
  );
  const expectedReservation = getOfficeAdvertisedPriceReservation(
    input.reservation
  );

  if (state.kind !== "office") {
    return yield* new AdvertisedPriceMismatchError({
      reason: "input_mismatch",
      message:
        "Advertised price snapshot does not match the submitted reservation.",
    });
  }

  if (
    state.locale !== input.locale ||
    !officeAdvertisedPriceReservationEquals(
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
  const affirmed = yield* pricing.affirmOfficeAdvertisement({
    reservation: expectedReservation,
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
    ...(changed && {
      changedKeys: getCheckoutSummaryChangedKeys(
        getOfficeCheckoutSummary(state.quote),
        getOfficeCheckoutSummary(affirmed.quote)
      ),
    }),
  };
});

export const ensureOfficePayStateAvailable = (input: {
  readonly availability: typeof WorkspaceAvailabilityService.Service;
  readonly reservation: Pick<
    OfficeReservationDetails,
    "kind" | "startsOn" | "endsOn" | "seats"
  >;
}) =>
  normalizeReservationIntervalFields(
    getOfficeReservationIntervalInput(input.reservation),
    workspaceSiteConstants.location.timeZone
  ).pipe(
    Effect.flatMap((interval) =>
      input.availability.ensureAvailable({
        kind: input.reservation.kind,
        ...interval,
        seats: input.reservation.seats,
      })
    )
  );

export const getPreparedOfficeCheckoutDetails = (input: {
  readonly locale: Locale;
  readonly prepared: PreparedOfficePayState;
  readonly legalEvidence: CheckoutDetails["legal"];
}): CheckoutDetails =>
  getOfficeCheckoutDetails({
    locale: input.locale,
    reservation: input.prepared.reservation,
    quote: input.prepared.quote,
    legalEvidence: input.legalEvidence,
  });
