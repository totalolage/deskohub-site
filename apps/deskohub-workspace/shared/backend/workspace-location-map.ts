import "server-only";

import { Effect } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import { generateStaticMapImage, type StaticMapImageOptions } from "osm";
import { workspaceLocationMapImageOptions } from "@/shared/utils/workspace-location-map";

// The OpenStreetMap tile usage policy asks clients to keep parallel tile
// downloads low; one map render needs dozens of tiles.
export const workspaceLocationMapTileConcurrency = 4;

// The policy also asks for downloaded tiles to be cached for at least seven
// days. Next's data cache keeps them across requests, instances, and
// deployments, so a render after a CDN miss reuses them.
const tileCacheSeconds = 7 * 24 * 60 * 60;

export const generateWorkspaceLocationMapImage = (
  options: StaticMapImageOptions = workspaceLocationMapImageOptions
) =>
  generateStaticMapImage(options).pipe(
    Effect.withConcurrency(workspaceLocationMapTileConcurrency),
    Effect.provide(FetchHttpClient.layer),
    Effect.provideService(FetchHttpClient.RequestInit, {
      next: { revalidate: tileCacheSeconds },
    })
  );
