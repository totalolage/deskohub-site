import "server-only";

import { join } from "node:path";
import { Effect } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import { generateStaticMapImage, type StaticMapImageOptions } from "osm";
import { workspaceLocationMapImageOptions } from "@/shared/utils/workspace-location-map";

// The OpenStreetMap tile usage policy asks clients to keep parallel tile
// downloads low; one map render needs dozens of tiles.
export const workspaceLocationMapTileConcurrency = 4;

// The tile usage policy also asks clients to cache tiles. Next's fetch cache
// stores the tile responses themselves, shared by every instance and kept
// across deployments, so a render after a CDN miss reuses tiles it already
// downloaded.
const tileCacheSeconds = 7 * 24 * 60 * 60;

// Vercel functions have no system fonts, so the map attribution brings its own.
const attributionFont = {
  file: join(process.cwd(), "assets", "fonts", "Geist", "regular.ttf"),
  family: "Geist",
};

export const generateWorkspaceLocationMapImage = (
  options: StaticMapImageOptions = workspaceLocationMapImageOptions
) =>
  generateStaticMapImage({ attributionFont, ...options }).pipe(
    Effect.withConcurrency(workspaceLocationMapTileConcurrency),
    Effect.provide(FetchHttpClient.layer),
    Effect.provideService(FetchHttpClient.RequestInit, {
      cache: "force-cache",
      next: { revalidate: tileCacheSeconds },
    })
  );
