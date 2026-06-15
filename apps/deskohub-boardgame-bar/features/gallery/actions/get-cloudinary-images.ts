"use server";

import {
  normalizeExpression,
  type UnnormalizedLogicalExpression,
} from "@deskohub/cloudinary";
import { Effect } from "effect";
import { applyCacheTags, cloudinaryTags } from "@/shared/utils/cache-tags";
import {
  type CloudinaryAsset,
  CloudinaryServiceLive,
  getGalleryImages,
} from "../backend/cloudinary.service";
import type { CloudinaryTag } from "../types/cloudinary-tag";

export interface GetGalleryImagesOptions {
  tags: UnnormalizedLogicalExpression<CloudinaryTag>;
  maxResults?: number;
}

// Cached function using 'use cache' directive
export async function getCloudinaryImages(
  options: GetGalleryImagesOptions
): Promise<readonly CloudinaryAsset[]> {
  "use cache";

  const { tags, maxResults = 50 } = options;

  // Apply cache tags for selective invalidation
  // Tag both general cloudinary cache and specific search
  applyCacheTags(cloudinaryTags.all(), cloudinaryTags.search(tags, maxResults));

  // Normalize the tag expression to CNF format
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
    Effect.tapError(
      Effect.fn(function* (error) {
        yield* Effect.logError("Cloudinary search failed", error);
      })
    ),
    Effect.catchAll((error) =>
      Effect.gen(function* () {
        yield* Effect.logWarning(
          "Boardgame gallery Cloudinary image lookup fell back to empty result",
          {
            tags,
            normalizedTags,
            maxResults,
            error,
          }
        );

        return [] as readonly CloudinaryAsset[];
      })
    )
  );

  return Effect.runPromise(getImagesEffect);
}
