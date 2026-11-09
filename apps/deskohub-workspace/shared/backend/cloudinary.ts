import "server-only";

import {
  CloudinaryService,
  makeCloudinaryRuntimeConfigLayer,
} from "@deskohub/cloudinary/server";
import { Layer } from "effect";
import { env } from "@/env";

const WorkspaceCloudinaryRuntimeConfigLayer = makeCloudinaryRuntimeConfigLayer({
  cloudName: env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME,
  apiKey: env.CLOUDINARY_API_KEY,
  apiSecret: env.CLOUDINARY_API_SECRET,
  defaultPageSize: 60,
  serviceName: "workspace",
});

export const WorkspaceCloudinaryLayer = CloudinaryService.Live.pipe(
  Layer.provide(WorkspaceCloudinaryRuntimeConfigLayer)
);
