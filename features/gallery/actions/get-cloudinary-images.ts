"use server";

import { Effect } from "effect";
import { unstable_cache as cache } from "next/cache";
import { cloudinaryImageCacheTags } from "@/shared/backend/utils/cache-tags";
import {
  type CloudinaryAsset,
  CloudinaryServiceLive,
  getGalleryImages,
} from "../backend/cloudinary.service";

export type GallerySearchType = "tag" | "folder" | "collection" | "all";

export interface GetGalleryImagesOptions {
  searchType?: GallerySearchType;
  searchValue?: string;
  maxResults?: number;
}

// Internal cached function
export async function getCloudinaryImages(
  options: GetGalleryImagesOptions
): Promise<readonly CloudinaryAsset[]> {
  const {
    searchType = "folder",
    searchValue = "Web Fotky",
    maxResults = 50,
  } = options;

  const getImagesEffect = Effect.provide(
    getGalleryImages(searchType, searchValue, {
      maxResults,
    }),
    CloudinaryServiceLive
  );

  return cache(
    () => Effect.runPromise(getImagesEffect),
    // Cache key generation - creates unique key for each option combination
    ["getCloudinaryImages"],
    {
      tags: Object.values(
        cloudinaryImageCacheTags({
          searchType,
          searchValue,
          maxResults,
        })
      ).filter(Boolean),
    }
  )();
}
