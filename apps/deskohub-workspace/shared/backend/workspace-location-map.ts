import "server-only";

import { Effect } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import { generateStaticMapImage } from "osm";
import { workspaceLocationMapImageOptions } from "@/shared/utils/workspace-location-map";

export const generateWorkspaceLocationMapImage = () =>
  generateStaticMapImage(workspaceLocationMapImageOptions).pipe(
    Effect.provide(FetchHttpClient.layer)
  );
