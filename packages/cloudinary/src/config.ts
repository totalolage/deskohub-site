import "server-only";

import { v2 as cloudinary } from "cloudinary";
import { Context, Effect, Layer } from "effect";
import { CloudinaryConfigError } from "./errors";

export interface CloudinaryConfig {
  readonly cloudName: string;
  readonly apiKey: string;
  readonly apiSecret: string;
  readonly defaultMaxResults?: number;
  readonly serviceName?: string;
  readonly timestampToleranceSeconds?: number;
}

export class CloudinaryRuntimeConfig extends Context.Service<
  CloudinaryRuntimeConfig,
  CloudinaryConfig
>()("@deskohub/cloudinary/CloudinaryRuntimeConfig") {}

export const makeCloudinaryRuntimeConfigLayer = (config: CloudinaryConfig) =>
  Layer.succeed(CloudinaryRuntimeConfig, config);

export function validateCloudinaryRuntimeConfig(config: CloudinaryConfig) {
  for (const field of ["cloudName", "apiKey", "apiSecret"] as const) {
    if (!config[field].trim()) {
      return Effect.fail(
        new CloudinaryConfigError({
          message: `Cloudinary ${field} is required`,
        })
      );
    }
  }

  return Effect.succeed(config);
}

export function configureCloudinarySdk(config: CloudinaryConfig) {
  return Effect.sync(() => {
    cloudinary.config({
      cloud_name: config.cloudName,
      api_key: config.apiKey,
      api_secret: config.apiSecret,
    });
  });
}
