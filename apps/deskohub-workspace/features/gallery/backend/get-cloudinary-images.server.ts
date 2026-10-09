import "server-only";

import {
  normalizeExpression,
  type SearchOptions,
  type UnnormalizedLogicalExpression,
} from "@deskohub/cloudinary";
import { getGalleryImages } from "@deskohub/cloudinary/server";
import { Effect } from "effect";
import { cacheLife, cacheTag } from "next/cache";
import { runWorkspaceEffect } from "@/shared/backend/workspace-effect";
import { cloudinaryTags } from "@/shared/utils/cache-tags";
import type { CloudinaryTag } from "../types/cloudinary-tag";
import {
  type CloudinaryAsset,
  WorkspaceCloudinaryLayer,
} from "./cloudinary.service";

const cloudinaryFailureCacheLife = {
  stale: 30,
  revalidate: 60,
  expire: 300,
} as const;

interface GetCloudinaryImagesOptions extends SearchOptions {
  tags: UnnormalizedLogicalExpression<CloudinaryTag>;
}

export async function getCloudinaryImages({
  tags,
  maxResults,
  sortBy,
  sortDirection,
}: GetCloudinaryImagesOptions): Promise<readonly CloudinaryAsset[]> {
  // Shared across server instances: a per-instance cache re-searches
  // Cloudinary on every cold start and spends the account-wide Search API
  // rate limit that production and every preview share.
  "use cache: remote";
  cacheLife("max");
  const expression = normalizeExpression(tags);
  // Empty or negative-only groups let Cloudinary search the whole cloud.
  if (
    expression.length === 0 ||
    expression.some((group) => !group.some((tag) => !tag.startsWith("!")))
  ) {
    return [];
  }

  cacheTag(cloudinaryTags.all(), cloudinaryTags.search(tags, maxResults ?? 50));

  // A Cloudinary outage or Admin API rate limit (HTTP 420) must not fail the
  // page: under Cache Components a throwing "use cache" function fails the
  // prerender even when the caller catches it. The failure is logged by the
  // runner; serve no photos and refresh soon. The expiry stays at the
  // 5-minute prerender threshold so callers without a Suspense boundary
  // remain part of the static shell instead of becoming dynamic holes.
  return getGalleryImages(expression, {
    maxResults,
    sortBy,
    sortDirection,
  })
    .pipe(
      Effect.provide(WorkspaceCloudinaryLayer),
      runWorkspaceEffect("gallery.images.load")
    )
    .catch((): readonly CloudinaryAsset[] => {
      cacheLife(cloudinaryFailureCacheLife);
      return [];
    });
}
