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
    DATABASE_URL: process.env.DATABASE_URL,
    DOTYPOS_API_TIMEOUT: process.env.DOTYPOS_API_TIMEOUT,
    DOTYPOS_API_URL: process.env.DOTYPOS_API_URL,
    DOTYPOS_BRANCH_ID: process.env.DOTYPOS_BRANCH_ID,
    DOTYPOS_CLIENT_ID: process.env.DOTYPOS_CLIENT_ID,
    DOTYPOS_CLIENT_SECRET: process.env.DOTYPOS_CLIENT_SECRET,
    DOTYPOS_CLOUD_ID: process.env.DOTYPOS_CLOUD_ID,
    DOTYPOS_EMPLOYEE_ID: process.env.DOTYPOS_EMPLOYEE_ID,
    DOTYPOS_REFRESH_TOKEN: process.env.DOTYPOS_REFRESH_TOKEN,
    WORKSPACE_DOTYPOS_TABLE_ID: process.env.WORKSPACE_DOTYPOS_TABLE_ID,
    EMAIL_API_KEY: process.env.EMAIL_API_KEY,
    NEXI_API_KEY: process.env.NEXI_API_KEY,
    NEXI_API_ORIGIN: process.env.NEXI_API_ORIGIN,
    NEXI_CHECKOUT_CURRENCY_OVERRIDE:
      process.env.NEXI_CHECKOUT_CURRENCY_OVERRIDE,
    VERCEL_AUTOMATION_BYPASS_SECRET:
      process.env.VERCEL_AUTOMATION_BYPASS_SECRET,
    VERCEL_ENV: process.env.VERCEL_ENV,
    VERCEL_PROJECT_PRODUCTION_URL: process.env.VERCEL_PROJECT_PRODUCTION_URL,
    VERCEL_URL: process.env.VERCEL_URL,
    NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME:
      process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME,
    NEXT_PUBLIC_GTM_ID: process.env.NEXT_PUBLIC_GTM_ID,
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
} as const;
