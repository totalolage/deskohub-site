import { createEnv } from "@t3-oss/env-nextjs";
import {
  type WorkspaceClientEnv,
  type WorkspaceServerEnv,
  workspaceClientEnvSchema,
  workspaceServerEnvSchema,
} from "./env.schema";

export const env = createEnv({
  server: workspaceServerEnvSchema.shape,
  client: workspaceClientEnvSchema.shape,
  runtimeEnv: {
    CLOUDINARY_API_KEY: process.env.CLOUDINARY_API_KEY,
    CLOUDINARY_API_SECRET: process.env.CLOUDINARY_API_SECRET,
    EMAIL_API_KEY: process.env.EMAIL_API_KEY,
    NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME:
      process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME,
    NEXT_PUBLIC_GTM_ID: process.env.NEXT_PUBLIC_GTM_ID,
    NEXT_PUBLIC_WORKSPACE_ENV: process.env.NEXT_PUBLIC_WORKSPACE_ENV,
  },
  emptyStringAsUndefined: true,
  onValidationError: (error) => {
    console.error(
      "Invalid workspace environment variables:",
      JSON.stringify(error, null, 2)
    );
    throw new Error("Invalid workspace environment variables");
  },
  onInvalidAccess: (variable) => {
    throw new Error(
      `Attempted to access server-side workspace environment variable '${variable}' on the client`
    );
  },
});

export type WorkspaceEnv = WorkspaceServerEnv & WorkspaceClientEnv;

export const publicEnv = {
  NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME: env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME,
  NEXT_PUBLIC_GTM_ID: env.NEXT_PUBLIC_GTM_ID,
  NEXT_PUBLIC_WORKSPACE_ENV: env.NEXT_PUBLIC_WORKSPACE_ENV,
} as const;
