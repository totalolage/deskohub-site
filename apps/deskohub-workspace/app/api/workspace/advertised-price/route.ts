import { CheckoutPricingServiceLiveWithDependencies } from "@/features/checkout/backend/checkout/checkout-pricing.runtime";
import { makeWorkspaceAdvertisedPricePost } from "@/features/checkout/backend/checkout/workspace-advertised-price-route.server";

export const POST = makeWorkspaceAdvertisedPricePost(
  CheckoutPricingServiceLiveWithDependencies
);
