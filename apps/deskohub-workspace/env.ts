import { createEnv } from "@t3-oss/env-nextjs";
import {
  createEnvironmentSchema,
  workspaceClientEnvSchema,
  workspaceServerEnvSchema,
} from "./env.schema";

export const env = createEnv({
  server: workspaceServerEnvSchema.fields,
  client: workspaceClientEnvSchema.fields,
  runtimeEnv: {
    CLOUDINARY_API_KEY: process.env.CLOUDINARY_API_KEY,
    CLOUDINARY_API_SECRET: process.env.CLOUDINARY_API_SECRET,
    DATABASE_URL: process.env.DATABASE_URL,
    DATABASE_URL_UNPOOLED: process.env.DATABASE_URL_UNPOOLED,
    ADMIN_BASIC_AUTH_SHA256: process.env.ADMIN_BASIC_AUTH_SHA256,
    DOTYPOS_API_TIMEOUT: process.env.DOTYPOS_API_TIMEOUT,
    DOTYPOS_API_URL: process.env.DOTYPOS_API_URL,
    DOTYPOS_BRANCH_ID: process.env.DOTYPOS_BRANCH_ID,
    DOTYPOS_CLIENT_ID: process.env.DOTYPOS_CLIENT_ID,
    DOTYPOS_CLIENT_SECRET: process.env.DOTYPOS_CLIENT_SECRET,
    DOTYPOS_CLOUD_ID: process.env.DOTYPOS_CLOUD_ID,
    DOTYPOS_EMPLOYEE_ID: process.env.DOTYPOS_EMPLOYEE_ID,
    DOTYPOS_REFRESH_TOKEN: process.env.DOTYPOS_REFRESH_TOKEN,
    EMAIL_API_KEY: process.env.EMAIL_API_KEY,
    GOOGLE_CALENDAR_PRIVATE_KEY: process.env.GOOGLE_CALENDAR_PRIVATE_KEY,
    GOOGLE_CALENDAR_SALES_ID: process.env.GOOGLE_CALENDAR_SALES_ID,
    GOOGLE_CALENDAR_SERVICE_ACCOUNT_EMAIL:
      process.env.GOOGLE_CALENDAR_SERVICE_ACCOUNT_EMAIL,
    GOOGLE_CALENDAR_WORKSPACE_LIMITATIONS_ID:
      process.env.GOOGLE_CALENDAR_WORKSPACE_LIMITATIONS_ID,
    RESEND_WEBHOOK_SECRET: process.env.RESEND_WEBHOOK_SECRET,
    CHECKOUT_PAY_STATE_KEYS: process.env.CHECKOUT_PAY_STATE_KEYS,
    CHECKOUT_RESERVATION_HMAC_SECRET:
      process.env.CHECKOUT_RESERVATION_HMAC_SECRET,
    CHECKOUT_RESERVATION_HMAC_CUTOVER_AT:
      process.env.CHECKOUT_RESERVATION_HMAC_CUTOVER_AT,
    CHECKOUT_RESERVATION_HMAC_LEGACY_READ_UNTIL:
      process.env.CHECKOUT_RESERVATION_HMAC_LEGACY_READ_UNTIL,
    CHECKOUT_RETURN_STATE_TOKEN_SECRET:
      process.env.CHECKOUT_RETURN_STATE_TOKEN_SECRET,
    CRON_SECRET: process.env.CRON_SECRET,
    NEXI_API_KEY: process.env.NEXI_API_KEY,
    NEXI_API_ORIGIN: process.env.NEXI_API_ORIGIN,
    NEXI_CHECKOUT_CURRENCY_OVERRIDE:
      process.env.NEXI_CHECKOUT_CURRENCY_OVERRIDE,
    POSTHOG_SERVICE_NAME: process.env.POSTHOG_SERVICE_NAME,
    POSTHOG_SERVICE_NAMESPACE: process.env.POSTHOG_SERVICE_NAMESPACE,
    POSTHOG_FEATURE_FLAG_OVERRIDES: process.env.POSTHOG_FEATURE_FLAG_OVERRIDES,
    VERCEL_AUTOMATION_BYPASS_SECRET:
      process.env.VERCEL_AUTOMATION_BYPASS_SECRET,
    VERCEL_ENV: process.env.VERCEL_ENV,
    VERCEL_GIT_COMMIT_SHA: process.env.VERCEL_GIT_COMMIT_SHA,
    VERCEL_PROJECT_PRODUCTION_URL: process.env.VERCEL_PROJECT_PRODUCTION_URL,
    VERCEL_URL: process.env.VERCEL_URL,
    WORKSPACE_PAYMENT_ADMISSION_VERSION:
      process.env.WORKSPACE_PAYMENT_ADMISSION_VERSION,
    NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME:
      process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME,
    NEXT_PUBLIC_GTM_ID: process.env.NEXT_PUBLIC_GTM_ID,
    NEXT_PUBLIC_POSTHOG_HOST: process.env.NEXT_PUBLIC_POSTHOG_HOST,
    NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN:
      process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN,
    NEXT_PUBLIC_VERCEL_ENV: process.env.NEXT_PUBLIC_VERCEL_ENV,
  },
  createFinalSchema: createEnvironmentSchema,
  emptyStringAsUndefined: true,
  onValidationError: (error) => {
    const sanitizedError = error.map((issue) => {
      const path = issue.path?.map((segment) => {
        const key = typeof segment === "object" ? segment.key : segment;
        return typeof key === "string" || typeof key === "number"
          ? key
          : "unknown";
      });
      const isFeatureFlagOverride = path?.includes(
        "POSTHOG_FEATURE_FLAG_OVERRIDES"
      );
      const isReservationHmac = path?.some((key) => {
        return (
          typeof key === "string" &&
          key.startsWith("CHECKOUT_RESERVATION_HMAC_")
        );
      });
      const isAdminBasicAuth = path?.includes("ADMIN_BASIC_AUTH_SHA256");

      return {
        path,
        message: isFeatureFlagOverride
          ? "Invalid PostHog feature flag override configuration."
          : isReservationHmac
            ? "Invalid checkout reservation HMAC rollout configuration."
            : isAdminBasicAuth
              ? "Invalid administration authentication hash."
              : issue.message,
      };
    });

    throw new Error(
      `Invalid workspace environment variables: ${JSON.stringify(sanitizedError, null, 2)}`
    );
  },
  onInvalidAccess: (variable) => {
    throw new Error(
      `Attempted to access server-side workspace environment variable '${variable}' on the client`
    );
  },
});
