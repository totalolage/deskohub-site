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
    const advertised = yield* pricing.quoteAdvertisement(input);
    const state = yield* buildAdvertisedPriceState({
      ...advertised,
      locale: input.locale,
    });
    const advertisedPriceToken = yield* sealAdvertisedPriceState(state);
    const { reservation: _, ...advertisedPrice } = advertised;

    return {
      ...advertisedPrice,
      advertisedPriceToken,
    } satisfies AdvertisedPrice;
  }
);
