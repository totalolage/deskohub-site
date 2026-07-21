import { Data, Effect, type Layer, Predicate, Schema } from "effect";
import { NextResponse } from "next/server";
import { workspaceAdvertisedPriceRequestSchema } from "@/features/checkout/advertised-price";
import type { DiscountService } from "@/features/discounts";
import { runWorkspaceRequestEffect } from "@/shared/backend/logging/censorship";
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
  (effect) =>
    effect.pipe(
      Effect.scoped,
      Effect.annotateLogs({
        method: "POST",
        operation: "workspaceAdvertisedPrice",
      })
    )
);

const handleAdvertisedPriceError = Effect.fn(
  "handleWorkspaceAdvertisedPriceError"
)(function* (error: unknown) {
  const invalidRequest = Predicate.isTagged(
    error,
    "WorkspaceAdvertisedPriceRequestError"
  );

  yield* invalidRequest
    ? Effect.logWarning("Workspace advertised price request was invalid", {
        errorTag: "WorkspaceAdvertisedPriceRequestError",
      })
    : Effect.logError("Workspace advertised price request failed", {
        errorTag:
          error && typeof error === "object" && "_tag" in error
            ? String(error._tag)
            : "UnknownError",
      });

  return NextResponse.json(
    { error: "Workspace advertised price could not be loaded" },
    { status: invalidRequest ? 400 : 500 }
  );
});

export const makeWorkspaceAdvertisedPricePost =
  <E>(discountServiceLayer: Layer.Layer<DiscountService, E>) =>
  async (request: Request): Promise<NextResponse> =>
    runWorkspaceRequestEffect(
      request,
      loadAdvertisedPrice(request).pipe(
        Effect.provide(discountServiceLayer),
        Effect.map((result) =>
          NextResponse.json(result, {
            headers: { "Cache-Control": "private, no-store" },
          })
        ),
        Effect.catch(handleAdvertisedPriceError)
      )
    );
