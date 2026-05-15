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

export type GalleryImagesResult =
  | { status: "ok"; assets: readonly CloudinaryAsset[] }
  | { status: "error"; errorCode: "gallery_unavailable" };

export interface GetCloudinaryImagesOptions {
  tags: UnnormalizedLogicalExpression<CloudinaryTag>;
  maxResults?: number;
}

export async function getCloudinaryImages({
  tags,
  maxResults = 60,
}: GetCloudinaryImagesOptions): Promise<GalleryImagesResult> {
  "use cache";

  applyCacheTags(cloudinaryTags.all(), cloudinaryTags.search(tags, maxResults));

  return Effect.provide(
    getGalleryImages(normalizeExpression(tags), { maxResults }),
    CloudinaryServiceLive
  ).pipe(
    Effect.map((assets) => ({ status: "ok" as const, assets })),
    Effect.tapError((error) =>
      Effect.logError("Workspace Cloudinary gallery search failed", error)
    ),
    Effect.catchAll(() =>
      Effect.succeed({
        status: "error" as const,
        errorCode: "gallery_unavailable" as const,
      })
    ),
    Effect.runPromise
  );
}
