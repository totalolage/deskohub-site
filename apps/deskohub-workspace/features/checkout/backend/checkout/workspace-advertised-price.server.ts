import { Effect } from "effect";
import type {
  WorkspaceAdvertisedPrice,
  WorkspaceAdvertisedPriceRequest,
} from "@/features/checkout/advertised-price";
import { calculateWorkspaceCheckoutQuote } from "@/features/checkout/checkout-quote";
import { DiscountService } from "@/features/discounts";
import {
  buildAdvertisedPriceState,
  sealAdvertisedPriceState,
} from "./advertised-price-state";
import { getWorkspaceCheckoutPricingContext } from "./workspace-checkout-quote.server";

export const buildWorkspaceAdvertisedPrice = Effect.fn(
  "buildWorkspaceAdvertisedPrice"
)(function* (input: WorkspaceAdvertisedPriceRequest) {
  const pricing = yield* getWorkspaceCheckoutPricingContext({
    reservation: input.reservation.details,
  });
  const discounts = yield* DiscountService;
  const discountQuote = yield* discounts.advertise({
    ...pricing.discountInput,
    locale: input.locale,
  });
  const quote = yield* calculateWorkspaceCheckoutQuote(pricing.order, {
    discountQuote,
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
