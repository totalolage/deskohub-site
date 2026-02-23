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
    WORKSPACE_API_URL: process.env.WORKSPACE_API_URL,
    WORKSPACE_INTERNAL_API_KEY: process.env.WORKSPACE_INTERNAL_API_KEY,
    NEXT_PUBLIC_WORKSPACE_APP_URL: process.env.NEXT_PUBLIC_WORKSPACE_APP_URL,
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
  NEXT_PUBLIC_WORKSPACE_APP_URL: env.NEXT_PUBLIC_WORKSPACE_APP_URL,
  NEXT_PUBLIC_WORKSPACE_ENV: env.NEXT_PUBLIC_WORKSPACE_ENV,
} as const;
