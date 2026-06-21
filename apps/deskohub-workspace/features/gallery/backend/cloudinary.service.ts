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
  makeCloudinaryRuntimeConfigLayer,
} from "@deskohub/cloudinary/server";
import { Layer } from "effect";
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

const CloudinaryRuntimeConfigLive = makeCloudinaryRuntimeConfigLayer({
  cloudName: env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME,
  apiKey: env.CLOUDINARY_API_KEY,
  apiSecret: env.CLOUDINARY_API_SECRET,
  defaultMaxResults: 60,
  serviceName: "workspace",
});

export const CloudinaryServiceLive = CloudinaryService.Live.pipe(
  Layer.provide(CloudinaryRuntimeConfigLive)
);
