import "server-only";

import {
  type CloudinaryAsset,
  normalizeExpression,
  type UnnormalizedLogicalExpression,
} from "@deskohub/cloudinary";
import { getGalleryImages } from "@deskohub/cloudinary/server";
import { Effect } from "effect";
import { applyCacheTags, cloudinaryTags } from "@/shared/utils/cache-tags";
import type { CloudinaryTag } from "../types/cloudinary-tag";
import { GalleryCloudinaryLayer } from "./cloudinary.service";

export async function getCloudinaryImages(options: {
  tags: UnnormalizedLogicalExpression<CloudinaryTag>;
  maxResults?: number;
}): Promise<readonly CloudinaryAsset[]> {
  "use cache";

  const { tags, maxResults = 50 } = options;

  applyCacheTags(cloudinaryTags.all(), cloudinaryTags.search(tags, maxResults));

  return Effect.runPromise(getCloudinaryImagesEffect(tags, maxResults));
}

export function getCloudinaryImagesEffect(
  tags: UnnormalizedLogicalExpression<CloudinaryTag>,
  maxResults: number
): Effect.Effect<readonly CloudinaryAsset[], never> {
  const expression = normalizeExpression(tags);

  return Effect.provide(
    Effect.gen(function* () {
      yield* Effect.logInfo(
        "Boardgame gallery Cloudinary image lookup started"
      );

      const assets = yield* getGalleryImages(expression, { maxResults });

      if (assets.length === 0) {
        yield* Effect.logWarning(
          "Boardgame gallery Cloudinary image lookup returned no assets",
          { resultCount: 0 }
        );
      }

      yield* Effect.logInfo(
        "Boardgame gallery Cloudinary image lookup completed",
        { resultCount: assets.length }
      );

      return assets;
    }).pipe(Effect.scoped),
    GalleryCloudinaryLayer
  ).pipe(
    Effect.catch(() =>
      Effect.logError("Boardgame gallery Cloudinary image lookup failed").pipe(
        Effect.as([] as readonly CloudinaryAsset[])
      )
    )
  );
}
