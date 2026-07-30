import "server-only";

import { Effect, Option } from "effect";
import {
  type AdvertisedPriceRequest,
  advertisedPriceRequestEquals,
  type PreloadedAdvertisedPrice,
} from "@/features/checkout/advertised-price";
import { buildAdvertisedPrice } from "@/features/checkout/backend/checkout/advertised-price.server";

export const loadInitialAdvertisedPrices = Effect.fn(
  "reservationPage.loadInitialAdvertisedPrices"
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
        Effect.tapError(() =>
          Effect.logError("Initial advertised price load failed", {
            reservation: request.reservation,
          })
        ),
        Effect.option,
        Effect.map(
          Option.map(
            (advertisedPrice): PreloadedAdvertisedPrice => ({
              request,
              advertisedPrice,
            })
          )
        )
      )
    ),
    { concurrency: "unbounded" }
  );

  return results.filter(Option.isSome).map(({ value }) => value);
});
