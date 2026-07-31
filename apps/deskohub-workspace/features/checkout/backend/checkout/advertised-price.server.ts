import { Effect, Match } from "effect";
import type {
  AdvertisedPrice,
  AdvertisedPriceRequest,
} from "@/features/checkout/advertised-price";
import { getCoworkCheckoutSummary } from "@/features/checkout/checkout-summary-cowork";
import { getMeetingRoomCheckoutSummary } from "@/features/checkout/checkout-summary-meeting-room";
import {
  buildAdvertisedPriceState,
  sealAdvertisedPriceState,
} from "./advertised-price-state";
import { CheckoutPricingService } from "./checkout-pricing.service";

export const buildAdvertisedPrice = Effect.fn("buildAdvertisedPrice")(
  function* (input: AdvertisedPriceRequest) {
    const pricing = yield* CheckoutPricingService;
    const advertised = yield* pricing.quoteAdvertisement(input);
    const state = yield* buildAdvertisedPriceState({
      ...advertised,
      locale: input.locale,
    });
    const advertisedPriceToken = yield* sealAdvertisedPriceState(state);
    const { reservation: _, ...advertisedPrice } = advertised;
    const summary = Match.value(advertised).pipe(
      Match.discriminatorsExhaustive("kind")({
        cowork: ({ quote, reservation }) =>
          getCoworkCheckoutSummary(reservation.details, quote),
        "meeting-room": ({ quote, reservation }) =>
          getMeetingRoomCheckoutSummary(reservation.details, quote),
      })
    );

    return {
      ...advertisedPrice,
      summary,
      advertisedPriceToken,
    } satisfies AdvertisedPrice;
  }
);
