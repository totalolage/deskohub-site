import { Effect } from "effect";
import { NextResponse } from "next/server";
import {
  isLocationMapFraming,
  locationMapFramingImageOptions,
  locationMapFramingPath,
} from "@/features/landing-page/location-map";
import { respondWithWorkspaceLocationMap } from "@/shared/backend/workspace-location-map-response";
import { defineWorkspaceRoute } from "@/shared/backend/workspace-route";

type LocationMapFramingRouteContext = {
  readonly params: Promise<{ readonly image: string }>;
};

/** The landing page's static map, framed for one breakpoint. */
export const GET = defineWorkspaceRoute(
  {
    operation: "workspaceLocationMap.getFraming",
    cancellation: "interrupt-on-disconnect",
    caller: "client",
  },
  (request: Request, { params }: LocationMapFramingRouteContext) =>
    Effect.promise(() => params).pipe(
      Effect.flatMap(({ image }) => {
        const framing = image.replace(/\.webp$/, "");
        if (!image.endsWith(".webp") || !isLocationMapFraming(framing)) {
          return Effect.succeed(new NextResponse(null, { status: 404 }));
        }

        return respondWithWorkspaceLocationMap(request, {
          canonicalPath: locationMapFramingPath(framing),
          contentType: "image/webp",
          options: locationMapFramingImageOptions(framing),
        });
      })
    )
);
