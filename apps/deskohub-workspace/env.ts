import { createEnv } from "@t3-oss/env-nextjs";
import {
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
    DATABASE_URL_UNPOOLED: process.env.DATABASE_URL_UNPOOLED,
    DOTYPOS_API_TIMEOUT: process.env.DOTYPOS_API_TIMEOUT,
    DOTYPOS_API_URL: process.env.DOTYPOS_API_URL,
    DOTYPOS_BRANCH_ID: process.env.DOTYPOS_BRANCH_ID,
    DOTYPOS_CLIENT_ID: process.env.DOTYPOS_CLIENT_ID,
    DOTYPOS_CLIENT_SECRET: process.env.DOTYPOS_CLIENT_SECRET,
    DOTYPOS_CLOUD_ID: process.env.DOTYPOS_CLOUD_ID,
    DOTYPOS_EMPLOYEE_ID: process.env.DOTYPOS_EMPLOYEE_ID,
    DOTYPOS_REFRESH_TOKEN: process.env.DOTYPOS_REFRESH_TOKEN,
    EMAIL_API_KEY: process.env.EMAIL_API_KEY,
    GOOGLE_CALENDAR_ID: process.env.GOOGLE_CALENDAR_ID,
    GOOGLE_CALENDAR_PRIVATE_KEY: process.env.GOOGLE_CALENDAR_PRIVATE_KEY,
    GOOGLE_CALENDAR_SERVICE_ACCOUNT_EMAIL:
      process.env.GOOGLE_CALENDAR_SERVICE_ACCOUNT_EMAIL,
    RESEND_WEBHOOK_SECRET: process.env.RESEND_WEBHOOK_SECRET,
    CHECKOUT_PAY_STATE_KEYS: process.env.CHECKOUT_PAY_STATE_KEYS,
    CHECKOUT_RETURN_STATE_TOKEN_SECRET:
      process.env.CHECKOUT_RETURN_STATE_TOKEN_SECRET,
    CRON_SECRET: process.env.CRON_SECRET,
    NEXI_API_KEY: process.env.NEXI_API_KEY,
    NEXI_API_ORIGIN: process.env.NEXI_API_ORIGIN,
    NEXI_CHECKOUT_CURRENCY_OVERRIDE:
      process.env.NEXI_CHECKOUT_CURRENCY_OVERRIDE,
    POSTHOG_SERVICE_NAME: process.env.POSTHOG_SERVICE_NAME,
    POSTHOG_SERVICE_NAMESPACE: process.env.POSTHOG_SERVICE_NAMESPACE,
    VERCEL_AUTOMATION_BYPASS_SECRET:
      process.env.VERCEL_AUTOMATION_BYPASS_SECRET,
    VERCEL_ENV: process.env.VERCEL_ENV,
    VERCEL_PROJECT_PRODUCTION_URL: process.env.VERCEL_PROJECT_PRODUCTION_URL,
    VERCEL_URL: process.env.VERCEL_URL,
    WORKSPACE_CALLBACK_ORIGIN: process.env.WORKSPACE_CALLBACK_ORIGIN,
    NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME:
      process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME,
    NEXT_PUBLIC_GTM_ID: process.env.NEXT_PUBLIC_GTM_ID,
    NEXT_PUBLIC_POSTHOG_HOST: process.env.NEXT_PUBLIC_POSTHOG_HOST,
    NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN:
      process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN,
  },
  emptyStringAsUndefined: true,
  onValidationError: (error) => {
    throw new Error(
      `Invalid workspace environment variables: ${JSON.stringify(error, null, 2)}`
    );
  },
  onInvalidAccess: (variable) => {
    throw new Error(
      `Attempted to access server-side workspace environment variable '${variable}' on the client`
    );
  },
});
