"use server";

import {
  normalizeExpression,
  type UnnormalizedLogicalExpression,
} from "@deskohub/cloudinary";
import { Effect } from "effect";
import { runWorkspaceEffect } from "@/shared/backend/logging/censorship";
import { applyCacheTags, cloudinaryTags } from "@/shared/utils/cache-tags";
import {
  type CloudinaryAsset,
  CloudinaryServiceLive,
  getGalleryImages,
} from "../backend/cloudinary.service";
import type { CloudinaryTag } from "../types/cloudinary-tag";

export interface GetCloudinaryImagesOptions {
  tags: UnnormalizedLogicalExpression<CloudinaryTag>;
  maxResults?: number;
}

export async function getCloudinaryImages({
  tags,
  maxResults = 60,
}: GetCloudinaryImagesOptions): Promise<readonly CloudinaryAsset[]> {
  "use cache";

  applyCacheTags(cloudinaryTags.all(), cloudinaryTags.search(tags, maxResults));

  return Effect.provide(
    getGalleryImages(normalizeExpression(tags), { maxResults }),
    CloudinaryServiceLive
  ).pipe(
    Effect.tapError((error) =>
      Effect.logError("Workspace Cloudinary gallery search failed", error)
    ),
    runWorkspaceEffect
  );
}
