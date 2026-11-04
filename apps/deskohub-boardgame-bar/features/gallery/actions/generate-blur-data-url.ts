import type { CloudinaryAsset } from "@deskohub/cloudinary";
import { applyCacheTags, cloudinaryTags } from "@/shared/utils/cache-tags";
import { generateBlurDataUrl } from "../utils/generate-blur-data-url";

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

  return generateBlurDataUrl(asset);
};
