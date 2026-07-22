"use server";

import { Effect, Schema } from "effect";
import { advertisedPriceRequestSchema } from "@/features/checkout/advertised-price";
import { buildAdvertisedPrice } from "@/features/checkout/backend/checkout/advertised-price.server";
import { CheckoutPricingServiceLiveWithDependencies } from "@/features/checkout/backend/checkout/checkout-pricing.runtime";
import { defineWorkspaceAction } from "@/shared/backend/workspace-action";

const getAdvertisedPriceAction = defineWorkspaceAction(
  {
    operation: "checkout.advertised-price.load",
    schema: Schema.toStandardSchemaV1(advertisedPriceRequestSchema, {
      parseOptions: { onExcessProperty: "error" },
    }),
  },
  (input) =>
    buildAdvertisedPrice(input).pipe(
      Effect.provide(CheckoutPricingServiceLiveWithDependencies),
      Effect.scoped
    )
);

export const getAdvertisedPrice: typeof getAdvertisedPriceAction = async (
  ...args: Parameters<typeof getAdvertisedPriceAction>
) => {
  "use server";
  return await getAdvertisedPriceAction(...args);
};
