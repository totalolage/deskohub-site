"use server";

import { Effect } from "effect";
import { applyCacheTags, cloudinaryTags } from "@/shared/utils/cache-tags";
import {
  normalizeExpression,
  type UnnormalizedLogicalExpression,
} from "@/shared/utils/normalize-tag-expression";
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
    getGalleryImages(normalizedTags, {
      maxResults,
    }),
    CloudinaryServiceLive
  );

  return Effect.runPromise(getImagesEffect);
}
