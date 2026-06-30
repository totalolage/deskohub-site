"use server";

import {
  normalizeExpression,
  type UnnormalizedLogicalExpression,
} from "@deskohub/cloudinary";
import { Effect } from "effect";
import { env } from "@/env";
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
    Effect.catch((error) => {
      if (env.VERCEL_ENV !== "development") return Effect.fail(error);

      return Effect.logWarning(
        "Workspace Cloudinary gallery search skipped in development"
      ).pipe(Effect.as([] as readonly CloudinaryAsset[]));
    }),
    Effect.tapError((error) =>
      Effect.logError("Workspace Cloudinary gallery search failed", error)
    ),
    runWorkspaceEffect
  );
}
