"use server";

import type {
  CloudinaryAsset,
  UnnormalizedLogicalExpression,
} from "@deskohub/cloudinary";
import { normalizeExpression } from "@deskohub/cloudinary";
import { getGalleryImages } from "@deskohub/cloudinary/server";
import { Effect } from "effect";
import { applyCacheTags, cloudinaryTags } from "@/shared/utils/cache-tags";
import { CloudinaryServiceLive } from "../backend/cloudinary.service";
import type { CloudinaryTag } from "../types/cloudinary-tag";

// Cached function using 'use cache' directive
export async function getCloudinaryImages(options: {
  tags: UnnormalizedLogicalExpression<CloudinaryTag>;
  maxResults?: number;
}): Promise<readonly CloudinaryAsset[]> {
  "use cache";

  const { tags, maxResults = 50 } = options;

  // Apply cache tags for selective invalidation
  // Tag both general cloudinary cache and specific search
  applyCacheTags(cloudinaryTags.all(), cloudinaryTags.search(tags, maxResults));

  const normalizedTags = normalizeExpression(tags);

  const getImagesEffect = Effect.provide(
    Effect.gen(function* () {
      yield* Effect.annotateLogsScoped({ options, normalizedTags });
      yield* Effect.logInfo(
        "Boardgame gallery Cloudinary image lookup started",
        {
          tags,
          maxResults,
        }
      );

      const result = yield* getGalleryImages(normalizedTags, {
        maxResults,
      });

      yield* Effect.annotateLogsScoped({ result });
      if (result.length === 0) {
        yield* Effect.logWarning(
          "Boardgame gallery Cloudinary image lookup returned no assets",
          {
            tags,
            normalizedTags,
            maxResults,
          }
        );
      }
      yield* Effect.logInfo(
        "Boardgame gallery Cloudinary image lookup completed",
        {
          tags,
          normalizedTags,
          maxResults,
          resultCount: result.length,
        }
      );

      return result;
    }).pipe(Effect.scoped, Effect.annotateLogs({ options, normalizedTags })),
    CloudinaryServiceLive
  ).pipe(
    Effect.catch((error) =>
      Effect.logError("Cloudinary search failed", error).pipe(Effect.as([]))
    )
  );

  return Effect.runPromise(getImagesEffect);
}
