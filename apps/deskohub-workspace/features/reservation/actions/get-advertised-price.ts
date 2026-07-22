"use server";

import { Effect, Schema } from "effect";
import {
  type AdvertisedPriceRequest,
  advertisedPriceRequestSchema,
} from "@/features/checkout/advertised-price";
import { buildAdvertisedPrice } from "@/features/checkout/backend/checkout/advertised-price.server";
import { CheckoutPricingServiceLiveWithDependencies } from "@/features/checkout/backend/checkout/checkout-pricing.runtime";
import { runWorkspaceServerActionEffect } from "@/shared/backend/logging/server-action";

const decodeRequest = Schema.decodeUnknownEffect(advertisedPriceRequestSchema, {
  onExcessProperty: "error",
});

const loadAdvertisedPrice = Effect.fn("getAdvertisedPrice")(function* (
  input: AdvertisedPriceRequest
) {
  const request = yield* decodeRequest(input);
  return yield* buildAdvertisedPrice(request);
});

export async function getAdvertisedPrice(input: AdvertisedPriceRequest) {
  return await runWorkspaceServerActionEffect(
    loadAdvertisedPrice(input).pipe(
      Effect.provide(CheckoutPricingServiceLiveWithDependencies),
      Effect.scoped
    )
  );
}
