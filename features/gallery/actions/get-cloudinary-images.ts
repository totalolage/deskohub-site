"use server";

import { Effect } from "effect";
import { unstable_cache as cache } from "next/cache";
import { cloudinaryImageCacheTags } from "@/shared/backend/utils/cache-tags";
import {
  type CloudinaryAsset,
  CloudinaryServiceLive,
  getGalleryImages,
} from "../backend/cloudinary.service";

export type GallerySearchType = "folder" | "collection";

export interface GetGalleryImagesOptions {
  search: `${GallerySearchType}:${string}`;
  tags?: string[];
  maxResults?: number;
}

// Internal cached function
export async function getCloudinaryImages(
  options: GetGalleryImagesOptions
): Promise<readonly CloudinaryAsset[]> {
  const { search, tags = [], maxResults = 50 } = options;

  // Parse the search string
  const [searchType, ...searchValueParts] = search.split(":") as [GallerySearchType, ...string[]];
  const searchValue = searchValueParts.join(":"); // In case the value contains colons

  const getImagesEffect = Effect.provide(
    getGalleryImages(
      searchType,
      searchValue,
      tags,
      {
        maxResults,
      }
    ),
    CloudinaryServiceLive
  );

  return cache(
    () => Effect.runPromise(getImagesEffect),
    // Cache key generation - creates unique key for each option combination
    ["getCloudinaryImages"],
    {
      tags: Object.values(
        cloudinaryImageCacheTags({
          search,
          tags,
          maxResults,
        })
      ).filter(Boolean),
    }
  )();
}
