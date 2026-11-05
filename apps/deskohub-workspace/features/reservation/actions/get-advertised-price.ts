"use server";

import { Effect, Layer, Schema } from "effect";
import { advertisedPriceRequestsSchema } from "@/features/checkout/advertised-price";
import { CheckoutPricingService } from "@/features/checkout/backend/checkout/checkout-pricing.service";
import { ReferralReleaseGateRequest } from "@/features/referrals/referral-release-gate.server";
import { loadAdvertisedPrices } from "@/features/reservation/backend/advertised-prices.server";
import { SealedStateKeys } from "@/shared/backend/sealed-state-keys.service";
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
      Effect.provide(
        Layer.mergeAll(
          CheckoutPricingService.Live.pipe(
            Layer.provideMerge(ReferralReleaseGateRequest)
          ),
          SealedStateKeys.Default
        )
      ),
      Effect.scoped
    )
);

export const getAdvertisedPrices: typeof getAdvertisedPricesAction = async (
  ...args: Parameters<typeof getAdvertisedPricesAction>
) => {
  "use server";
  return await getAdvertisedPricesAction(...args);
};
