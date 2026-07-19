import { Effect, Schema } from "effect";
import { urlStringSchema } from "./shared/utils/url-schema";

const toEnvSchema = <S extends Schema.Decoder<unknown>>(schema: S) =>
  Schema.toStandardSchemaV1(schema);

const stringSchema = toEnvSchema(Schema.String);
const nonEmptyStringSchema = toEnvSchema(Schema.NonEmptyString);
const urlEnvSchema = toEnvSchema(urlStringSchema);

const optionalStringSchema = toEnvSchema(Schema.optional(Schema.String));
const optionalUrlEnvSchema = toEnvSchema(Schema.optional(urlStringSchema));

export const workspaceServerEnvSchema = Schema.Struct({
  CLOUDINARY_API_KEY: nonEmptyStringSchema,
  CLOUDINARY_API_SECRET: nonEmptyStringSchema,
  DATABASE_URL: urlEnvSchema,
  DATABASE_URL_UNPOOLED: optionalUrlEnvSchema,
  DOTYPOS_API_TIMEOUT: toEnvSchema(
    Schema.NumberFromString.check(Schema.isInt())
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
  GOOGLE_CALENDAR_PRIVATE_KEY: nonEmptyStringSchema,
  GOOGLE_CALENDAR_SALES_ID: nonEmptyStringSchema,
  GOOGLE_CALENDAR_SERVICE_ACCOUNT_EMAIL: nonEmptyStringSchema,
  GOOGLE_CALENDAR_WORKSPACE_LIMITATIONS_ID: nonEmptyStringSchema,
  RESEND_WEBHOOK_SECRET: optionalStringSchema,
  CHECKOUT_PAY_STATE_KEYS: nonEmptyStringSchema,
  CHECKOUT_RETURN_STATE_TOKEN_SECRET: toEnvSchema(
    Schema.optional(Schema.String.check(Schema.isMinLength(32)))
  ),
  CRON_SECRET: toEnvSchema(Schema.optional(Schema.NonEmptyString)),
  NEXI_API_KEY: nonEmptyStringSchema,
  NEXI_API_ORIGIN: urlEnvSchema,
  NEXI_CHECKOUT_CURRENCY_OVERRIDE: toEnvSchema(
    Schema.optional(Schema.Literal("EUR"))
  ),
  POSTHOG_FEATURE_FLAGS_API_KEY: nonEmptyStringSchema,
  POSTHOG_HOST: toEnvSchema(
    Schema.URLFromString.pipe(
      Schema.withDecodingDefaultType(
        Effect.succeed(new URL("https://eu.posthog.com"))
      )
    )
  ),
  POSTHOG_PROJECT_ID: nonEmptyStringSchema,
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
  VERCEL_ENV: toEnvSchema(
    Schema.Literals(["production", "preview", "development"])
  ),
  VERCEL_AUTOMATION_BYPASS_SECRET: optionalStringSchema,
  VERCEL_PROJECT_PRODUCTION_URL: nonEmptyStringSchema,
  VERCEL_URL: nonEmptyStringSchema,
});

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
});

export type WorkspaceServerEnv = Schema.Schema.Type<
  typeof workspaceServerEnvSchema
>;
export type WorkspaceClientEnv = Schema.Schema.Type<
  typeof workspaceClientEnvSchema
>;
