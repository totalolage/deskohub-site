import { Data, Effect, type Layer, Predicate, Schema } from "effect";
import { NextResponse } from "next/server";
import { workspaceAdvertisedPriceRequestSchema } from "@/features/checkout/advertised-price";
import {
  makeWorkspaceNextEffect,
  WorkspaceRouteFailure,
} from "@/shared/backend/workspace-next-effect";
import type { CheckoutPricingService } from "./checkout-pricing.service";
import { buildWorkspaceAdvertisedPrice } from "./workspace-advertised-price.server";

const decodeRequest = Schema.decodeUnknownEffect(
  workspaceAdvertisedPriceRequestSchema,
  { onExcessProperty: "error" }
);

class WorkspaceAdvertisedPriceRequestError extends Data.TaggedError(
  "WorkspaceAdvertisedPriceRequestError"
)<{
  readonly cause: unknown;
}> {}

const loadAdvertisedPrice = Effect.fn("loadWorkspaceAdvertisedPrice")(
  function* (request: Request) {
    const body = yield* Effect.tryPromise({
      try: () => request.json(),
      catch: (cause) => new WorkspaceAdvertisedPriceRequestError({ cause }),
    });
    const input = yield* decodeRequest(body).pipe(
      Effect.mapError(
        (cause) => new WorkspaceAdvertisedPriceRequestError({ cause })
      )
    );
    return yield* buildWorkspaceAdvertisedPrice(input);
  },
  Effect.scoped
);

const toAdvertisedPriceRouteFailure = (error: unknown) => {
  const invalidRequest = Predicate.isTagged(
    error,
    "WorkspaceAdvertisedPriceRequestError"
  );

  return new WorkspaceRouteFailure({
    statusCode: invalidRequest ? 400 : 500,
    publicMessage: "Workspace advertised price could not be loaded",
    cause: error,
  });
};

export const makeWorkspaceAdvertisedPricePost = <E>(
  pricingServiceLayer: Layer.Layer<CheckoutPricingService, E>
) =>
  makeWorkspaceNextEffect({
    layer: pricingServiceLayer,
    mapLayerError: toAdvertisedPriceRouteFailure,
  }).route({ method: "POST", operation: "advertisedPrice" }, (request) =>
    loadAdvertisedPrice(request).pipe(
      Effect.mapError(toAdvertisedPriceRouteFailure),
      Effect.map((result) =>
        NextResponse.json(result, {
          headers: { "Cache-Control": "private, no-store" },
        })
      )
    )
  );
