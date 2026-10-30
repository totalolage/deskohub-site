import "server-only";

import {
  type CloudinaryAsset,
  normalizeExpression,
  type SearchOptions,
  type UnnormalizedLogicalExpression,
} from "@deskohub/cloudinary";
import { getGalleryImages } from "@deskohub/cloudinary/server";
import { Effect } from "effect";
import { cacheLife } from "next/cache";
import { WorkspaceCloudinaryLayer } from "@/shared/backend/cloudinary";
import { readSharedSnapshot } from "@/shared/backend/shared-snapshot";
import { cloudinaryTags } from "@/shared/utils/cache-tags";
import type { CloudinaryTag } from "../types/cloudinary-tag";

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
  const expression = normalizeExpression(tags);
  // Tag lists cannot answer empty or negative-only groups: they need a
  // positive tag to list from.
  if (
    expression.length === 0 ||
    expression.some((group) => !group.some((tag) => !tag.startsWith("!")))
  ) {
    cacheLife(cloudinaryGalleryCacheLife);
    return [];
  }

  const galleryTags = [
    cloudinaryTags.all(),
    cloudinaryTags.search(tags, maxResults ?? 50),
  ];

  // A Cloudinary outage, a rejected tag list request, or a Workspace runtime
  // that cannot start must not fail the page: under Cache Components a
  // throwing "use cache" function fails the prerender even when the caller
  // catches it. Serve no photos and refresh soon. The expiry stays at the
  // 5-minute prerender threshold so callers without a Suspense boundary
  // remain part of the static shell instead of becoming dynamic holes.
  // `getGalleryImages` logs the lookup failure; the reader logs the served
  // fallback under a stable code.
  return await readSharedSnapshot(
    "gallery.images.load",
    getGalleryImages(expression, { maxResults, sortBy, sortDirection }).pipe(
      Effect.provide(WorkspaceCloudinaryLayer)
    ),
    {
      complete: { lifetime: cloudinaryGalleryCacheLife, tags: galleryTags },
      failure: {
        failureCode: "gallery.images.load_failed",
        fallback: (): readonly CloudinaryAsset[] => [],
        lifetime: cloudinaryFailureCacheLife,
        tags: galleryTags,
      },
    }
  );
}
