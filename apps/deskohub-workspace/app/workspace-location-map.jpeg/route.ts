import { Effect } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import { NextResponse } from "next/server";
import { generateWorkspaceLocationMapImage } from "@/shared/backend/workspace-location-map";
import {
  defineWorkspaceRoute,
  mapWorkspaceInternalRouteFailure,
} from "@/shared/backend/workspace-route";

export const GET = defineWorkspaceRoute(
  {
    operation: "workspaceLocationMap.get",
    cancellation: "continue-after-disconnect",
  },
  (_request) =>
    generateWorkspaceLocationMapImage().pipe(
      Effect.map(
        (image) =>
          new NextResponse(new Uint8Array(image), {
            headers: {
              "Content-Type": "image/jpeg",
              "Cache-Control":
                "public, max-age=86400, s-maxage=604800, stale-while-revalidate=2592000",
            },
          })
      ),
      Effect.mapError(
        mapWorkspaceInternalRouteFailure(
          "Workspace location map could not be generated."
        )
      ),
      Effect.provide(FetchHttpClient.layer)
    )
);
