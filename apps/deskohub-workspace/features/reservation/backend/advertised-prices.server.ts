import "server-only";

import { Effect, Exit, Layer } from "effect";
import {
  type AdvertisedPriceRequest,
  advertisedPriceRequestEquals,
  type PreloadedAdvertisedPrice,
} from "@/features/checkout/advertised-price";
import { buildAdvertisedPrice } from "@/features/checkout/backend/checkout/advertised-price.server";
import { CheckoutPricingService } from "@/features/checkout/backend/checkout/checkout-pricing.service";
import { OfficeReleaseGateRequest } from "@/features/office/backend/office-release-gate.server";
import { ReferralReleaseGateRequest } from "@/features/referrals/referral-release-gate.server";
import { SealedStateKeys } from "@/shared/backend/sealed-state-keys.service";
import { pagePreload } from "./page-preload";

export const loadAdvertisedPrices = Effect.fn(
  "reservation.loadAdvertisedPrices"
)(function* (requests: ReadonlyArray<AdvertisedPriceRequest>) {
  const uniqueRequests = requests.filter(
    (request, index) =>
      requests.findIndex((candidate) =>
        advertisedPriceRequestEquals(candidate, request)
      ) === index
  );
  const results = yield* Effect.all(
    uniqueRequests.map((request) =>
      buildAdvertisedPrice(request).pipe(
        Effect.provide(OfficeReleaseGateRequest),
        Effect.exit,
        Effect.flatMap(
          Exit.match({
            onFailure: (cause) =>
              Effect.logError("Advertised price load failed", {
                cause,
                reservationKind: request.reservation.kind,
              }).pipe(Effect.as([])),
            onSuccess: (advertisedPrice) =>
              Effect.succeed<Array<PreloadedAdvertisedPrice>>([
                { request, advertisedPrice },
              ]),
          })
        )
      )
    ),
    { concurrency: 6 }
  );

  return results.flat();
});

/**
 * The prices a reservation page renders with, loaded with live pricing and
 * bounded by the page preload deadline. Nothing it fails or runs late on,
 * including starting pricing, fails the page: the client loads what is
 * missing.
 */
export const preloadPageAdvertisedPrices = (
  requests: ReadonlyArray<AdvertisedPriceRequest>
) =>
  loadAdvertisedPrices(requests).pipe(
    Effect.provide(
      Layer.mergeAll(
        CheckoutPricingService.Live.pipe(
          Layer.provideMerge(ReferralReleaseGateRequest)
        ),
        SealedStateKeys.Default
      )
    ),
    Effect.scoped,
    pagePreload("advertised prices")
  );
