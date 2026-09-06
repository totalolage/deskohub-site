import { createEnv } from "@t3-oss/env-nextjs";
import { Predicate } from "effect";
import {
  createEnvironmentSchema,
  workspaceClientEnvSchema,
  workspaceServerEnvSchema,
} from "./env.schema";

// Next only transforms statically named environment accesses. Key rotation is
// additive: configure the new variable, add its direct access here, deploy,
// and only then change the active key ID.
const accountingDocumentSnapshotSecrets: Readonly<
  Record<string, string | undefined>
> = {
  K202608: process.env.ACCOUNTING_DOCUMENT_SNAPSHOT_KEY_K202608,
};

export const env = createEnv({
  server: workspaceServerEnvSchema.fields,
  client: workspaceClientEnvSchema.fields,
  runtimeEnv: {
    ACCOUNTING_DOCUMENT_SNAPSHOT_ACTIVE_KEY_ID:
      process.env.ACCOUNTING_DOCUMENT_SNAPSHOT_ACTIVE_KEY_ID,
    CLOUDINARY_API_KEY: process.env.CLOUDINARY_API_KEY,
    CLOUDINARY_API_SECRET: process.env.CLOUDINARY_API_SECRET,
    DATABASE_URL: process.env.DATABASE_URL,
    DATABASE_URL_UNPOOLED: process.env.DATABASE_URL_UNPOOLED,
    ADMIN_BASIC_AUTH_CREDENTIALS: process.env.ADMIN_BASIC_AUTH_CREDENTIALS,
    BETTER_AUTH_SECRETS: process.env.BETTER_AUTH_SECRETS,
    DOTYPOS_API_TIMEOUT: process.env.DOTYPOS_API_TIMEOUT,
    DOTYPOS_API_URL: process.env.DOTYPOS_API_URL,
    DOTYPOS_BRANCH_ID: process.env.DOTYPOS_BRANCH_ID,
    DOTYPOS_CLIENT_ID: process.env.DOTYPOS_CLIENT_ID,
    DOTYPOS_CLIENT_SECRET: process.env.DOTYPOS_CLIENT_SECRET,
    DOTYPOS_CLOUD_ID: process.env.DOTYPOS_CLOUD_ID,
    DOTYPOS_EMPLOYEE_ID: process.env.DOTYPOS_EMPLOYEE_ID,
    DOTYPOS_REFRESH_TOKEN: process.env.DOTYPOS_REFRESH_TOKEN,
    EMAIL_API_KEY: process.env.EMAIL_API_KEY,
    EMAIL_PROVIDER: process.env.EMAIL_PROVIDER,
    GOOGLE_CALENDAR_PRIVATE_KEY: process.env.GOOGLE_CALENDAR_PRIVATE_KEY,
    GOOGLE_CALENDAR_SALES_ID: process.env.GOOGLE_CALENDAR_SALES_ID,
    GOOGLE_CALENDAR_SERVICE_ACCOUNT_EMAIL:
      process.env.GOOGLE_CALENDAR_SERVICE_ACCOUNT_EMAIL,
    GOOGLE_CALENDAR_WORKSPACE_LIMITATIONS_ID:
      process.env.GOOGLE_CALENDAR_WORKSPACE_LIMITATIONS_ID,
    GITHUB_STEP_SUMMARY: process.env.GITHUB_STEP_SUMMARY,
    IGLOOHOME_API_TIMEOUT: process.env.IGLOOHOME_API_TIMEOUT,
    IGLOOHOME_API_URL: process.env.IGLOOHOME_API_URL,
    IGLOOHOME_AUTH_URL: process.env.IGLOOHOME_AUTH_URL,
    IGLOOHOME_CLIENT_ID: process.env.IGLOOHOME_CLIENT_ID,
    IGLOOHOME_CLIENT_SECRET: process.env.IGLOOHOME_CLIENT_SECRET,
    IGLOOHOME_ALGOPIN_TARGET_DEVICE_ID:
      process.env.IGLOOHOME_ALGOPIN_TARGET_DEVICE_ID,
    RESEND_WEBHOOK_SECRET: process.env.RESEND_WEBHOOK_SECRET,
    CHECKOUT_PAY_STATE_KEYS: process.env.CHECKOUT_PAY_STATE_KEYS,
    CHECKOUT_RETURN_STATE_TOKEN_SECRET:
      process.env.CHECKOUT_RETURN_STATE_TOKEN_SECRET,
    RESERVATION_ACCESS_TOKEN_SECRET:
      process.env.RESERVATION_ACCESS_TOKEN_SECRET,
    CRON_SECRET: process.env.CRON_SECRET,
    NEXI_API_KEY: process.env.NEXI_API_KEY,
    NEXI_API_ORIGIN: process.env.NEXI_API_ORIGIN,
    NEXI_CHECKOUT_CURRENCY_OVERRIDE:
      process.env.NEXI_CHECKOUT_CURRENCY_OVERRIDE,
    POSTHOG_SERVICE_NAME: process.env.POSTHOG_SERVICE_NAME,
    POSTHOG_SERVICE_NAMESPACE: process.env.POSTHOG_SERVICE_NAMESPACE,
    POSTHOG_API_KEY: process.env.POSTHOG_API_KEY,
    POSTHOG_API_HOST: process.env.POSTHOG_API_HOST,
    POSTHOG_FEATURE_FLAG_OVERRIDES: process.env.POSTHOG_FEATURE_FLAG_OVERRIDES,
    POSTHOG_INGEST_HOST: process.env.POSTHOG_INGEST_HOST,
    POSTHOG_PROJECT_ID: process.env.POSTHOG_PROJECT_ID,
    PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH:
      process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    VERCEL_AUTOMATION_BYPASS_SECRET:
      process.env.VERCEL_AUTOMATION_BYPASS_SECRET,
    VERCEL_BRANCH_URL: process.env.VERCEL_BRANCH_URL,
    VERCEL_ENV: process.env.VERCEL_ENV,
    VERCEL_GIT_COMMIT_SHA: process.env.VERCEL_GIT_COMMIT_SHA,
    VERCEL_PROJECT_PRODUCTION_URL: process.env.VERCEL_PROJECT_PRODUCTION_URL,
    VERCEL_URL: process.env.VERCEL_URL,
    WORKSPACE_E2E_BASE_URL: process.env.WORKSPACE_E2E_BASE_URL,
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
      const hasPath = (key: string) =>
        issue.path?.some((segment) =>
          Predicate.isObject(segment) ? segment.key === key : segment === key
        );

      if (hasPath("POSTHOG_FEATURE_FLAG_OVERRIDES")) {
        return {
          ...issue,
          message: "Invalid PostHog feature flag override configuration.",
        };
      }

      if (hasPath("ADMIN_BASIC_AUTH_CREDENTIALS")) {
        return {
          ...issue,
          message: "Invalid administrator credential registry configuration.",
        };
      }

      if (hasPath("BETTER_AUTH_SECRETS")) {
        return {
          ...issue,
          message: "Invalid Better Auth secret configuration.",
        };
      }

      if (hasPath("IGLOOHOME_CLIENT_SECRET")) {
        return {
          ...issue,
          message: "Invalid Igloohome client credential configuration.",
        };
      }

      if (hasPath("EMAIL_API_KEY")) {
        return {
          ...issue,
          message: "Invalid production email delivery configuration.",
        };
      }

      if (hasPath("CRON_SECRET")) {
        return {
          ...issue,
          message: "Invalid production cron authentication configuration.",
        };
      }

      return issue;
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

export const getAccountingDocumentSnapshotSecret = (keyId: string) =>
  accountingDocumentSnapshotSecrets[keyId];
