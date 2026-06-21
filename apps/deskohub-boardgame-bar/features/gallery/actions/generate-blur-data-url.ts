import type { CloudinaryAsset } from "@deskohub/cloudinary";
import { getCldImageUrl } from "next-cloudinary";
import { applyCacheTags, cloudinaryTags } from "@/shared/utils/cache-tags";

/**
 * Server-side cached version of generateBlurDataUrl
 * Cached function to avoid regenerating the same blur data
 */
export const generateBlurDataUrlCached = async (
  asset: CloudinaryAsset
): Promise<string> => {
  "use cache";

  // Apply cache tags for selective invalidation
  applyCacheTags(...cloudinaryTags.getTags(asset.public_id));

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
};
