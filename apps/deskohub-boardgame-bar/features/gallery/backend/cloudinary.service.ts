import {
  CloudinaryService,
  makeCloudinaryRuntimeConfigLayer,
} from "@deskohub/cloudinary/server";
import { Layer } from "effect";
import { env } from "@/env";

const CloudinaryRuntimeConfigLive = makeCloudinaryRuntimeConfigLayer({
  cloudName: env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME,
  apiKey: env.CLOUDINARY_API_KEY,
  apiSecret: env.CLOUDINARY_API_SECRET,
  defaultMaxResults: 100,
  serviceName: "boardgame-bar",
});

export const CloudinaryServiceLive = CloudinaryService.Live.pipe(
  Layer.provide(CloudinaryRuntimeConfigLive)
);
