import { Effect } from "effect";
import type {
  AdvertisedPrice,
  AdvertisedPriceRequest,
} from "@/features/checkout/advertised-price";
import {
  buildAdvertisedPriceState,
  sealAdvertisedPriceState,
} from "./advertised-price-state";
import { CheckoutPricingService } from "./checkout-pricing.service";

export const buildAdvertisedPrice = Effect.fn("buildAdvertisedPrice")(
  function* (input: AdvertisedPriceRequest) {
    const pricing = yield* CheckoutPricingService;
    const quote = yield* pricing.quoteAdvertisement({
      reservation: input.reservation.details,
      locale: input.locale,
    });
    const state = yield* buildAdvertisedPriceState({
      locale: input.locale,
      reservation: input.reservation,
      quote,
    });

    return {
      quote,
      advertisedPriceToken: yield* sealAdvertisedPriceState(state),
    } satisfies AdvertisedPrice;
  }
);
