"use server";

import { Effect } from "effect";
import { unstable_cache as cache } from "next/cache";
import { CloudinaryImageCacheTags } from "@/shared/backend/utils/cache-tags";
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
  tags?: UnnormalizedLogicalExpression<CloudinaryTag>;
  maxResults?: number;
}

// Internal cached function
export async function getCloudinaryImages(
  options: GetGalleryImagesOptions
): Promise<readonly CloudinaryAsset[]> {
  const { tags, maxResults = 50 } = options;

  // Normalize the tag expression to CNF format
  const normalizedTags = tags ? normalizeExpression(tags) : [];

  const getImagesEffect = Effect.provide(
    getGalleryImages(normalizedTags, {
      maxResults,
    }),
    CloudinaryServiceLive
  );

  const cacheTags = new CloudinaryImageCacheTags({
    tags,
    maxResults,
  });

  return cache(() => Effect.runPromise(getImagesEffect), cacheTags.cacheTags, {
    tags: cacheTags.cacheTags,
  })();
}
