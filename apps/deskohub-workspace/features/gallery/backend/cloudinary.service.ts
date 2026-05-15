import {
  type CloudinaryAsset,
  CloudinaryAssetSchema,
  CloudinarySearchError,
  CloudinarySearchResponseSchema,
  type SearchOptions,
  SearchOptionsSchema,
} from "@deskohub/cloudinary";
import {
  CloudinaryService,
  getGalleryImages,
  makeCloudinaryServiceLive,
} from "@deskohub/cloudinary/server";
import { env } from "@/env";

export {
  CloudinaryAssetSchema,
  CloudinarySearchError,
  CloudinarySearchResponseSchema,
  CloudinaryService,
  SearchOptionsSchema,
  getGalleryImages,
  type CloudinaryAsset,
  type SearchOptions,
};

export const CloudinaryServiceLive = makeCloudinaryServiceLive({
  cloudName: env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME,
  apiKey: env.CLOUDINARY_API_KEY,
  apiSecret: env.CLOUDINARY_API_SECRET,
  defaultMaxResults: 60,
  serviceName: "workspace",
});
