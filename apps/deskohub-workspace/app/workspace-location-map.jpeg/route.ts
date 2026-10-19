import { Effect } from "effect";
import { NextResponse } from "next/server";
import { generateWorkspaceLocationMapImage } from "@/shared/backend/workspace-location-map";
import {
  defineWorkspaceRoute,
  WorkspaceRouteFailure,
} from "@/shared/backend/workspace-route";
import { workspaceLocationMapImagePath } from "@/shared/utils";

const cacheControl =
  "public, max-age=86400, s-maxage=604800, stale-while-revalidate=2592000";

export const GET = defineWorkspaceRoute(
  {
    operation: "workspaceLocationMap.get",
    cancellation: "interrupt-on-disconnect",
    caller: "client",
  },
  (request) => {
    // The CDN caches each query string separately, so any query would render
    // the map again. Every variant redirects to the one cached URL instead.
    const canonicalUrl = new URL(workspaceLocationMapImagePath, request.url);
    if (request.url !== canonicalUrl.href) {
      return Effect.succeed(
        NextResponse.redirect(canonicalUrl, {
          status: 308,
          headers: { "Cache-Control": cacheControl },
        })
      );
    }

    return generateWorkspaceLocationMapImage().pipe(
      Effect.map(
        (image) =>
          new NextResponse(new Uint8Array(image), {
            headers: {
              "Content-Type": "image/jpeg",
              "Cache-Control": cacheControl,
            },
          })
      ),
      Effect.mapError(
        WorkspaceRouteFailure.internal(
          "Workspace location map could not be generated."
        )
      )
    );
  }
);
