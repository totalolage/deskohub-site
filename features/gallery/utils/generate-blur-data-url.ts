import { unstable_cache as cache } from "next/cache";
import { getCldImageUrl } from "next-cloudinary";
import { CloudinaryImageCacheTags } from "@/shared/backend/utils/cache-tags";
import type { CloudinaryAsset } from "../backend/cloudinary.service";

/**
 * Generates a base64-encoded blur data URL for a Cloudinary image
 * @param publicId - The Cloudinary public ID of the image
 * @returns Base64-encoded data URL for use as a blur placeholder
 */
export const generateBlurDataUrl = async (
  asset: CloudinaryAsset
): Promise<string> => {
  const cacheTags = new CloudinaryImageCacheTags({
    publicId: asset.public_id,
  });

  const cachedFetch = cache(
    async () => {
      // Generate a very low-res URL (10x10 pixels, heavily compressed)
      const lowResUrl = getCldImageUrl({
        src: asset.public_id,
        width: 10,
        height: 10,
        format: "webp",
      });

      // Fetch the low-res image
      const response = await fetch(lowResUrl);
      if (!response.ok) {
        throw new Error(`Failed to fetch blur image: ${response.statusText}`);
      }

      // Convert to base64
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const base64 = buffer.toString("base64");

      // Determine content type
      const contentType = response.headers.get("content-type") || "image/webp";

      // Return as data URL
      return `data:${contentType};base64,${base64}`;
    },
    ["cloudinary-blur-image", asset.public_id],
    {
      tags: cacheTags.cacheTags,
    }
  );
  return cachedFetch();
};
