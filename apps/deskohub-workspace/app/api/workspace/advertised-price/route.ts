import { makeWorkspaceAdvertisedPricePost } from "@/features/checkout/backend/checkout/workspace-advertised-price-route.server";
import { DiscountServiceLiveWithDependencies } from "@/features/discounts/discount.runtime";

export const POST = makeWorkspaceAdvertisedPricePost(
  DiscountServiceLiveWithDependencies
);
