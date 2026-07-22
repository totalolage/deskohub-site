"use server";

import {
  normalizeExpression,
  type UnnormalizedLogicalExpression,
} from "@deskohub/cloudinary";
import { getGalleryImages } from "@deskohub/cloudinary/server";
import { Effect } from "effect";
import { env } from "@/env";
import { WorkspaceEffect } from "@/shared/backend/workspace-effect";
import {
  type CloudinaryAsset,
  CloudinaryServiceLive,
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
  return WorkspaceEffect.run(
    { operation: "gallery.images.load", layer: CloudinaryServiceLive },
    getGalleryImages(normalizeExpression(tags), { maxResults }).pipe(
      Effect.catch((error) => {
        if (env.VERCEL_ENV !== "development") return Effect.fail(error);

        return Effect.logWarning(
          "Workspace Cloudinary gallery search skipped in development"
        ).pipe(Effect.as([] as readonly CloudinaryAsset[]));
      }),
      Effect.tapError((error) =>
        Effect.logError("Workspace Cloudinary gallery search failed", error)
      )
    )
  );
}
