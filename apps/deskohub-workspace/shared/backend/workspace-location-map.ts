import "server-only";

import { Effect } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import { generateStaticMapImage } from "osm";
import { workspaceLocationMapImageOptions } from "@/shared/utils/workspace-location-map";

// The OpenStreetMap tile usage policy asks clients to keep parallel tile
// downloads low; one map render needs dozens of tiles.
export const workspaceLocationMapTileConcurrency = 4;

export const generateWorkspaceLocationMapImage = () =>
  generateStaticMapImage(workspaceLocationMapImageOptions).pipe(
    Effect.withConcurrency(workspaceLocationMapTileConcurrency),
    Effect.provide(FetchHttpClient.layer)
  );
