import { PostHogProjectId } from "@deskohub/posthog/identifiers";
import { Effect, Schema } from "effect";
import {
  postHogFeatureFlagOverridesEnvironmentCheck,
  postHogFeatureFlagOverridesSchema,
  vercelEnvironmentSchema,
} from "./features/feature-flags/feature-flag-overrides.schema";
import { urlStringSchema } from "./shared/utils/url-schema";

const toEnvSchema = <S extends Schema.Decoder<unknown>>(schema: S) =>
  Schema.toStandardSchemaV1(schema);

const stringSchema = toEnvSchema(Schema.String);
const nonEmptyStringSchema = toEnvSchema(Schema.NonEmptyString);
const urlEnvSchema = toEnvSchema(urlStringSchema);

const optionalStringSchema = toEnvSchema(Schema.optional(Schema.String));
const optionalNonEmptyStringSchema = toEnvSchema(
  Schema.optional(Schema.NonEmptyString)
);
const optionalUrlEnvSchema = toEnvSchema(Schema.optional(urlStringSchema));

const postHogBrowserEnvironmentCheck = Schema.makeFilter<{
  readonly NEXT_PUBLIC_POSTHOG_HOST?: string | undefined;
  readonly NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN?: string | undefined;
}>((environment) =>
  environment.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN !== undefined &&
  environment.NEXT_PUBLIC_POSTHOG_HOST === undefined
    ? [
        {
          path: ["NEXT_PUBLIC_POSTHOG_HOST"],
          issue:
            "NEXT_PUBLIC_POSTHOG_HOST is required when browser PostHog is enabled.",
        },
      ]
    : undefined
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

export const workspaceServerEnvSchema = Schema.Struct({
  ACCOUNTING_DOCUMENT_SNAPSHOT_ACTIVE_KEY_ID: toEnvSchema(
    Schema.String.check(Schema.isPattern(/^[A-Z][A-Z0-9_]{2,31}$/))
  ),
  CLOUDINARY_API_KEY: nonEmptyStringSchema,
  CLOUDINARY_API_SECRET: nonEmptyStringSchema,
  DATABASE_URL: urlEnvSchema,
  DATABASE_URL_UNPOOLED: optionalUrlEnvSchema,
  ADMIN_BASIC_AUTH_SHA256: toEnvSchema(
    Schema.optional(Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/)))
  ),
  BETTER_AUTH_SECRETS: toEnvSchema(Schema.optional(Schema.NonEmptyString)),
  DOTYPOS_API_TIMEOUT: toEnvSchema(
    Schema.FiniteFromString.check(Schema.isInt())
      .check(Schema.isGreaterThan(0))
      .pipe(Schema.withDecodingDefaultType(Effect.succeed(5_000)))
  ),
  DOTYPOS_API_URL: urlEnvSchema,
  DOTYPOS_BRANCH_ID: nonEmptyStringSchema,
  DOTYPOS_CLIENT_ID: nonEmptyStringSchema,
  DOTYPOS_CLIENT_SECRET: nonEmptyStringSchema,
  DOTYPOS_CLOUD_ID: nonEmptyStringSchema,
  DOTYPOS_EMPLOYEE_ID: nonEmptyStringSchema,
  DOTYPOS_REFRESH_TOKEN: nonEmptyStringSchema,
  EMAIL_API_KEY: optionalStringSchema,
  EMAIL_PROVIDER: toEnvSchema(
    Schema.optional(Schema.Literals(["resend", "console"]))
  ),
  GOOGLE_CALENDAR_PRIVATE_KEY: nonEmptyStringSchema,
  GOOGLE_CALENDAR_SALES_ID: nonEmptyStringSchema,
  GOOGLE_CALENDAR_SERVICE_ACCOUNT_EMAIL: nonEmptyStringSchema,
  GOOGLE_CALENDAR_WORKSPACE_LIMITATIONS_ID: nonEmptyStringSchema,
  GITHUB_STEP_SUMMARY: optionalStringSchema,
  IGLOOHOME_API_TIMEOUT: toEnvSchema(
    Schema.FiniteFromString.check(Schema.isInt())
      .check(Schema.isGreaterThan(0))
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
  igloohomeProductionEnvironmentCheck
);

export const workspaceClientEnvSchema = Schema.Struct({
  NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME: stringSchema,
  NEXT_PUBLIC_GTM_ID: optionalStringSchema,
  NEXT_PUBLIC_POSTHOG_HOST: optionalUrlEnvSchema,
  NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: toEnvSchema(
    Schema.optional(Schema.NonEmptyString)
  ),
  NEXT_PUBLIC_VERCEL_ENV: toEnvSchema(
    Schema.optional(Schema.Literals(["production", "preview", "development"]))
  ),
}).check(postHogBrowserEnvironmentCheck);

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
          igloohomeProductionEnvironmentCheck
        )
      : schema
  );
};

export type WorkspaceServerEnv = Schema.Schema.Type<
  typeof workspaceServerEnvSchema
>;
export type WorkspaceClientEnv = Schema.Schema.Type<
  typeof workspaceClientEnvSchema
>;
