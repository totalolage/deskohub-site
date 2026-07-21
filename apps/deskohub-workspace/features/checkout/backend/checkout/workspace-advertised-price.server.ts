import { Effect } from "effect";
import type {
  WorkspaceAdvertisedPrice,
  WorkspaceAdvertisedPriceRequest,
} from "@/features/checkout/advertised-price";
import {
  buildAdvertisedPriceState,
  sealAdvertisedPriceState,
} from "./advertised-price-state";
import { CheckoutPricingService } from "./checkout-pricing.service";

export const buildWorkspaceAdvertisedPrice = Effect.fn(
  "buildWorkspaceAdvertisedPrice"
)(function* (input: WorkspaceAdvertisedPriceRequest) {
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
  } satisfies WorkspaceAdvertisedPrice;
});
