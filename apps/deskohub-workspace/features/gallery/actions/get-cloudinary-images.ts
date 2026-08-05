"use server";

import {
  normalizeExpression,
  type SearchOptions,
  type UnnormalizedLogicalExpression,
} from "@deskohub/cloudinary";
import { getGalleryImages } from "@deskohub/cloudinary/server";
import { Effect } from "effect";
import { env } from "@/env";
import { runWorkspaceEffect } from "@/shared/backend/workspace-effect";
import {
  type CloudinaryAsset,
  CloudinaryServiceLive,
} from "../backend/cloudinary.service";
import type { CloudinaryTag } from "../types/cloudinary-tag";

export interface GetCloudinaryImagesOptions extends SearchOptions {
  tags: UnnormalizedLogicalExpression<CloudinaryTag>;
}

export async function getCloudinaryImages({
  tags,
  maxResults,
  sortBy,
  sortDirection,
}: GetCloudinaryImagesOptions): Promise<readonly CloudinaryAsset[]> {
  return getGalleryImages(normalizeExpression(tags), {
    maxResults,
    sortBy,
    sortDirection,
  }).pipe(
    Effect.catch((error) => {
      if (env.VERCEL_ENV !== "development") return Effect.fail(error);

      return Effect.logWarning(
        "Workspace Cloudinary gallery search skipped in development"
      ).pipe(Effect.as([] as readonly CloudinaryAsset[]));
    }),
    Effect.tapError((error) =>
      Effect.logError("Workspace Cloudinary gallery search failed", error)
    ),
    Effect.provide(CloudinaryServiceLive),
    runWorkspaceEffect("gallery.images.load")
  );
}
