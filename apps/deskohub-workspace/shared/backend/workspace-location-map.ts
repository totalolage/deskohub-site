import "server-only";

import { join } from "node:path";
import { Effect } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import { generateStaticMapImage, type StaticMapImageOptions } from "osm";
import { workspaceLocationMapImageOptions } from "@/shared/utils/workspace-location-map";

// The OpenStreetMap tile usage policy asks clients to keep parallel tile
// downloads low; one map render needs dozens of tiles.
export const workspaceLocationMapTileConcurrency = 4;

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
    Effect.provide(FetchHttpClient.layer)
  );
