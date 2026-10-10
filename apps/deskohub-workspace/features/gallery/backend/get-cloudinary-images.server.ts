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

/**
 * Gallery lists come from Cloudinary's CDN tag lists, which Cloudinary
 * regenerates at most once a minute. The Cloudinary webhook revalidates the
 * cache tags as soon as an asset changes, but a refetch inside that minute can
 * still read the previous list. A bounded revalidation period lets the next
 * background refresh pick up the regenerated list, so a tag change shows up
 * within about six minutes even when the webhook refresh raced the CDN. Tag
 * list requests spend no Admin API quota, so periodic refreshes are free of
 * rate-limit risk.
 */
const cloudinaryGalleryCacheLife = {
  stale: 300,
  revalidate: 300,
  expire: 86_400,
} as const;

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
  // Shared across server instances, so cold starts reuse the cached list
  // instead of refetching it from Cloudinary.
  "use cache: remote";
  cacheLife(cloudinaryGalleryCacheLife);
  const expression = normalizeExpression(tags);
  // Tag lists cannot answer empty or negative-only groups: they need a
  // positive tag to list from.
  if (
    expression.length === 0 ||
    expression.some((group) => !group.some((tag) => !tag.startsWith("!")))
  ) {
    return [];
  }

  cacheTag(cloudinaryTags.all(), cloudinaryTags.search(tags, maxResults ?? 50));

  // A Cloudinary outage or a rejected tag list request must not fail the
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
