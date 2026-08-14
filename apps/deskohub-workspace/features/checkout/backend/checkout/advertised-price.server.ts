import { Effect, Match } from "effect";
import type {
  AdvertisedPrice,
  AdvertisedPriceRequest,
} from "@/features/checkout/advertised-price";
import { getCoworkCheckoutSummary } from "@/features/checkout/checkout-summary-cowork";
import { getMeetingRoomCheckoutSummary } from "@/features/checkout/checkout-summary-meeting-room";
import { getOfficeCheckoutSummary } from "@/features/checkout/checkout-summary-office";
import { ensureOfficeReservationsEnabled } from "@/features/office/backend/office-reservation-feature-flag.service";
import {
  buildAdvertisedPriceState,
  sealAdvertisedPriceState,
} from "./advertised-price-state";
import { CheckoutPricingService } from "./checkout-pricing.service";

export const buildAdvertisedPrice = Effect.fn("buildAdvertisedPrice")(
  function* (input: AdvertisedPriceRequest) {
    yield* Match.value(input.reservation).pipe(
      Match.discriminatorsExhaustive("kind")({
        cowork: () => Effect.void,
        "meeting-room": () => Effect.void,
        office: () => ensureOfficeReservationsEnabled,
      })
    );

    const pricing = yield* CheckoutPricingService;
    const advertised = yield* pricing.quoteAdvertisement(input);
    const state = yield* buildAdvertisedPriceState({
      ...advertised,
      locale: input.locale,
    });
    const advertisedPriceToken = yield* sealAdvertisedPriceState(state);
    const summary = Match.value(advertised).pipe(
      Match.discriminatorsExhaustive("kind")({
        cowork: ({ quote, reservation }) =>
          getCoworkCheckoutSummary(reservation.details, quote),
        "meeting-room": ({ quote }) => getMeetingRoomCheckoutSummary(quote),
        office: ({ quote }) => getOfficeCheckoutSummary(quote),
      })
    );

    return {
      ...advertised,
      summary,
      advertisedPriceToken,
    } satisfies AdvertisedPrice;
  }
);
