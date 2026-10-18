import { dotyposApiTimeoutDefaultMilliseconds } from "@deskohub/dotypos/api-timeout";
import { igloohomeApiTimeoutMaximumMilliseconds } from "@deskohub/igloohome/config";
import { PostHogProjectId } from "@deskohub/posthog/identifiers";
import { Effect, Schema } from "effect";
import {
  optionalStringSchema,
  optionalUrlEnvSchema,
  postHogBrowserEnvironmentCheck,
  toEnvSchema,
  type workspaceClientEnvSchema,
} from "./client-env.schema";
import { parseBetterAuthSecrets } from "./features/account/backend/auth/auth-secrets";
import {
  postHogFeatureFlagOverridesEnvironmentCheck,
  postHogFeatureFlagOverridesSchema,
  vercelEnvironmentSchema,
} from "./features/feature-flags/feature-flag-overrides.schema";
import { urlStringSchema } from "./shared/utils/url-schema";

const nonEmptyStringSchema = toEnvSchema(Schema.NonEmptyString);
const urlEnvSchema = toEnvSchema(urlStringSchema);

const optionalNonEmptyStringSchema = toEnvSchema(
  Schema.optional(Schema.NonEmptyString)
);

const optionalEmailAddressSchema = toEnvSchema(
  Schema.optional(
    Schema.Trimmed.check(Schema.isPattern(/^[^\s@<>]+@[^\s@<>]+$/))
  )
);

const igloohomeProductionEnvironmentCheck = Schema.makeFilter<{
  readonly VERCEL_ENV: "production" | "preview" | "development";
  readonly IGLOOHOME_CLIENT_ID?: string | undefined;
  readonly IGLOOHOME_CLIENT_SECRET?: string | undefined;
}>((environment) => {
  if (environment.VERCEL_ENV !== "production") return undefined;

  return (["IGLOOHOME_CLIENT_ID", "IGLOOHOME_CLIENT_SECRET"] as const).flatMap(
    (key) =>
      environment[key] === undefined
        ? [{ path: [key], issue: `${key} is required in production.` }]
        : []
  );
});

const isBlank = (value: string | undefined): boolean =>
  value === undefined || value.trim() === "";

/**
 * Deployed environments must never serve a release whose account email
 * delivery is unconfigured: without a Resend key every message, including
 * magic links, is only logged. Production must also never leave cleanup jobs
 * publicly invokable without cron authentication. Development and test
 * environments stay usable without these secrets.
 */
const accountOperationsEnvironmentCheck = Schema.makeFilter<{
  readonly VERCEL_ENV: "production" | "preview" | "development";
  readonly EMAIL_API_KEY?: string | undefined;
  readonly CRON_SECRET?: string | undefined;
}>((environment) => {
  if (environment.VERCEL_ENV === "development") return undefined;

  const requirements: readonly (readonly [
    "EMAIL_API_KEY" | "CRON_SECRET",
    string,
  ])[] = [
    ["EMAIL_API_KEY", "EMAIL_API_KEY is required in production and preview."],
    ...(environment.VERCEL_ENV === "production"
      ? [["CRON_SECRET", "CRON_SECRET is required in production."] as const]
      : []),
  ];

  return requirements.flatMap(([key, issue]) =>
    isBlank(environment[key]) ? [{ path: [key], issue }] : []
  );
});

/**
 * Production must never serve a release whose account authentication cannot
 * bootstrap. The account-owned secrets parser is the authority for the
 * versioned, duplicate-free, strong-secret contract; environments outside
 * production may omit the variable entirely.
 */
const betterAuthSecretsProductionEnvironmentCheck = Schema.makeFilter<{
  readonly VERCEL_ENV: "production" | "preview" | "development";
  readonly BETTER_AUTH_SECRETS?: string | undefined;
}>((environment) => {
  if (environment.VERCEL_ENV !== "production") return undefined;

  return parseBetterAuthSecrets(environment.BETTER_AUTH_SECRETS).kind ===
    "valid"
    ? undefined
    : [
        {
          path: ["BETTER_AUTH_SECRETS"],
          issue:
            "BETTER_AUTH_SECRETS must contain valid versioned secrets in production.",
        },
      ];
});

export const workspaceServerEnvSchema = Schema.Struct({
  ACCOUNTING_DOCUMENT_SNAPSHOT_ACTIVE_KEY_ID: toEnvSchema(
    Schema.String.check(Schema.isPattern(/^[A-Z][A-Z0-9_]{2,31}$/))
  ),
  CLOUDINARY_API_KEY: nonEmptyStringSchema,
  CLOUDINARY_API_SECRET: nonEmptyStringSchema,
  DATABASE_URL: urlEnvSchema,
  DATABASE_URL_UNPOOLED: optionalUrlEnvSchema,
  BETTER_AUTH_SECRETS: toEnvSchema(Schema.optional(Schema.NonEmptyString)),
  DOTYPOS_API_TIMEOUT: toEnvSchema(
    Schema.FiniteFromString.check(Schema.isInt())
      .check(Schema.isGreaterThan(0))
      .pipe(
        Schema.withDecodingDefaultType(
          Effect.succeed(dotyposApiTimeoutDefaultMilliseconds)
        )
      )
  ),
  DOTYPOS_API_URL: urlEnvSchema,
  DOTYPOS_BRANCH_ID: nonEmptyStringSchema,
  DOTYPOS_CLIENT_ID: nonEmptyStringSchema,
  DOTYPOS_CLIENT_SECRET: nonEmptyStringSchema,
  DOTYPOS_CLOUD_ID: nonEmptyStringSchema,
  DOTYPOS_EMPLOYEE_ID: nonEmptyStringSchema,
  DOTYPOS_REFRESH_TOKEN: nonEmptyStringSchema,
  EMAIL_API_KEY: optionalStringSchema,
  EMAIL_CAMPAIGN_ADMIN_INBOX: optionalEmailAddressSchema,
  EMAIL_CAMPAIGN_FROM: optionalEmailAddressSchema,
  EMAIL_CAMPAIGN_REPLY_TO: optionalEmailAddressSchema,
  GOOGLE_CALENDAR_PRIVATE_KEY: nonEmptyStringSchema,
  GOOGLE_CALENDAR_SALES_ID: nonEmptyStringSchema,
  GOOGLE_CALENDAR_SERVICE_ACCOUNT_EMAIL: nonEmptyStringSchema,
  GOOGLE_CALENDAR_WORKSPACE_LIMITATIONS_ID: nonEmptyStringSchema,
  GITHUB_STEP_SUMMARY: optionalStringSchema,
  IGLOOHOME_API_TIMEOUT: toEnvSchema(
    Schema.FiniteFromString.check(Schema.isInt())
      .check(Schema.isGreaterThan(0))
      .check(Schema.isLessThanOrEqualTo(igloohomeApiTimeoutMaximumMilliseconds))
      .pipe(Schema.withDecodingDefaultType(Effect.succeed(10_000)))
  ),
  IGLOOHOME_API_URL: toEnvSchema(
    urlStringSchema.pipe(
      Schema.withDecodingDefaultType(
        Effect.succeed("https://api.igloodeveloper.co/igloohome")
      )
    )
  ),
  IGLOOHOME_AUTH_URL: toEnvSchema(
    urlStringSchema.pipe(
      Schema.withDecodingDefaultType(
        Effect.succeed("https://auth.igloohome.co")
      )
    )
  ),
  IGLOOHOME_CLIENT_ID: optionalNonEmptyStringSchema,
  IGLOOHOME_CLIENT_SECRET: optionalNonEmptyStringSchema,
  IGLOOHOME_ALGOPIN_TARGET_DEVICE_ID: nonEmptyStringSchema,
  RESEND_WEBHOOK_SECRET: nonEmptyStringSchema,
  CHECKOUT_PAY_STATE_KEYS: nonEmptyStringSchema,
  CHECKOUT_RETURN_STATE_TOKEN_SECRET: toEnvSchema(
    Schema.optional(Schema.String.check(Schema.isMinLength(32)))
  ),
  RESERVATION_ACCESS_TOKEN_SECRET: toEnvSchema(
    Schema.optional(Schema.String.check(Schema.isMinLength(32)))
  ),
  CRON_SECRET: toEnvSchema(Schema.optional(Schema.NonEmptyString)),
  ANALYTICS_WAREHOUSE_SOURCE_TOKEN: toEnvSchema(
    Schema.optional(Schema.String.check(Schema.isMinLength(32)))
  ),
  NEXI_API_KEY: nonEmptyStringSchema,
  NEXI_API_ORIGIN: urlEnvSchema,
  NEXI_CHECKOUT_CURRENCY_OVERRIDE: toEnvSchema(
    Schema.optional(Schema.Literal("EUR"))
  ),
  POSTHOG_SERVICE_NAME: toEnvSchema(
    Schema.NonEmptyString.pipe(
      Schema.withDecodingDefaultType(Effect.succeed("deskohub-workspace"))
    )
  ),
  POSTHOG_SERVICE_NAMESPACE: toEnvSchema(
    Schema.NonEmptyString.pipe(
      Schema.withDecodingDefaultType(Effect.succeed("deskohub"))
    )
  ),
  POSTHOG_API_KEY: toEnvSchema(Schema.optional(Schema.NonEmptyString)),
  POSTHOG_API_HOST: urlEnvSchema,
  POSTHOG_FEATURE_FLAG_OVERRIDES: toEnvSchema(
    postHogFeatureFlagOverridesSchema
  ),
  POSTHOG_INGEST_HOST: urlEnvSchema,
  POSTHOG_PROJECT_ID: toEnvSchema(Schema.optional(PostHogProjectId)),
  PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH: optionalStringSchema,
  VERCEL_BRANCH_URL: optionalStringSchema,
  VERCEL_ENV: toEnvSchema(vercelEnvironmentSchema),
  VERCEL_GIT_COMMIT_SHA: optionalStringSchema,
  VERCEL_AUTOMATION_BYPASS_SECRET: optionalStringSchema,
  VERCEL_PROJECT_PRODUCTION_URL: nonEmptyStringSchema,
  VERCEL_URL: nonEmptyStringSchema,
  WORKSPACE_E2E_BASE_URL: optionalUrlEnvSchema,
}).check(
  postHogFeatureFlagOverridesEnvironmentCheck,
  igloohomeProductionEnvironmentCheck,
  accountOperationsEnvironmentCheck,
  betterAuthSecretsProductionEnvironmentCheck
);

/**
 * T3 Env normally validates the field dictionary, which cannot retain checks
 * that depend on multiple fields. Compose its final schema here so server-only
 * deployment checks run without coupling them to `env.ts`.
 */
export const createEnvironmentSchema = (
  fields: typeof workspaceServerEnvSchema.fields &
    typeof workspaceClientEnvSchema.fields,
  isServer: boolean
) => {
  const schema = Schema.Struct(fields).check(postHogBrowserEnvironmentCheck);

  return Schema.toStandardSchemaV1(
    isServer
      ? schema.check(
          postHogFeatureFlagOverridesEnvironmentCheck,
          igloohomeProductionEnvironmentCheck,
          accountOperationsEnvironmentCheck,
          betterAuthSecretsProductionEnvironmentCheck
        )
      : schema
  );
};
