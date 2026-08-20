import {
  CloudinaryService,
  makeCloudinaryRuntimeConfigLayer,
} from "@deskohub/cloudinary/server";
import { Layer } from "effect";
import { env } from "@/env";

const galleryCloudinaryConfigLayer = makeCloudinaryRuntimeConfigLayer({
  cloudName: env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME,
  apiKey: env.CLOUDINARY_API_KEY,
  apiSecret: env.CLOUDINARY_API_SECRET,
  defaultPageSize: 100,
  serviceName: "boardgame-bar",
});

export const GalleryCloudinaryLayer = CloudinaryService.Default.pipe(
  Layer.provide(galleryCloudinaryConfigLayer)
);
