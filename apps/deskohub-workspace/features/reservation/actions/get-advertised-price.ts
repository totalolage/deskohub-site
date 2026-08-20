"use server";

import { Effect, Schema } from "effect";
import { advertisedPriceRequestsSchema } from "@/features/checkout/advertised-price";
import { CheckoutPricingService } from "@/features/checkout/backend/checkout/checkout-pricing.service";
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
      Effect.provide(CheckoutPricingService.Live),
      Effect.scoped
    )
);

export const getAdvertisedPrices: typeof getAdvertisedPricesAction = async (
  ...args: Parameters<typeof getAdvertisedPricesAction>
) => {
  "use server";
  return await getAdvertisedPricesAction(...args);
};
