"use server";

import { Effect, Schema } from "effect";
import { advertisedPriceRequestsSchema } from "@/features/checkout/advertised-price";
import { CheckoutPricingServiceLiveWithDependencies } from "@/features/checkout/backend/checkout/checkout-pricing.runtime";
import { loadAdvertisedPrices } from "@/features/reservation/backend/advertised-prices.server";
import { defineWorkspaceAction } from "@/shared/backend/workspace-action";

const getAdvertisedPricesAction = defineWorkspaceAction(
  {
    operation: "checkout.advertised-prices.load",
    schema: Schema.toStandardSchemaV1(advertisedPriceRequestsSchema, {
      parseOptions: { onExcessProperty: "error" },
    }),
  },
  (requests) =>
    loadAdvertisedPrices(requests).pipe(
      Effect.provide(CheckoutPricingServiceLiveWithDependencies),
      Effect.scoped
    )
);

export const getAdvertisedPrices: typeof getAdvertisedPricesAction = async (
  ...args: Parameters<typeof getAdvertisedPricesAction>
) => {
  "use server";
  return await getAdvertisedPricesAction(...args);
};
