import "server-only";

import { Effect } from "effect";
import { NextResponse } from "next/server";
import type { StaticMapImageOptions } from "osm";
import { generateWorkspaceLocationMapImage } from "./workspace-location-map";
import { WorkspaceRouteFailure } from "./workspace-route";

const cacheControl =
  "public, max-age=86400, s-maxage=604800, stale-while-revalidate=2592000";

/**
 * Serves a rendered location map from its one canonical path. The CDN caches
 * each query string separately, so any query would render the map again;
 * every variant redirects to the canonical URL instead.
 */
export const respondWithWorkspaceLocationMap = (
  request: Request,
  {
    canonicalPath,
    contentType,
    options,
  }: {
    readonly canonicalPath: string;
    readonly contentType: string;
    readonly options?: StaticMapImageOptions;
  }
) => {
  const canonicalUrl = new URL(canonicalPath, request.url);
  if (request.url !== canonicalUrl.href) {
    return Effect.succeed(
      NextResponse.redirect(canonicalUrl, {
        status: 308,
        headers: { "Cache-Control": cacheControl },
      })
    );
  }

  return generateWorkspaceLocationMapImage(options).pipe(
    Effect.map(
      (image) =>
        new NextResponse(new Uint8Array(image), {
          headers: {
            "Content-Type": contentType,
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
};
