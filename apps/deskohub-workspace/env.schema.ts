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
const optionalUrlEnvSchema = toEnvSchema(Schema.optional(urlStringSchema));
const optionalCheckoutHmacSecretSchema = toEnvSchema(
  Schema.optional(Schema.String.check(Schema.isMinLength(32)))
);
const optionalUtcInstantSchema = toEnvSchema(
  Schema.optional(
    Schema.String.check(
      Schema.makeFilter(
        (value) =>
          (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) &&
            Number.isFinite(Date.parse(value))) ||
          "Expected a UTC RFC 3339 instant."
      )
    )
  )
);

export const checkoutReservationHmacEnvironmentCheck = Schema.makeFilter<{
  readonly CHECKOUT_RESERVATION_HMAC_SECRET?: string | undefined;
  readonly CHECKOUT_RESERVATION_HMAC_CUTOVER_AT?: string | undefined;
  readonly CHECKOUT_RESERVATION_HMAC_LEGACY_READ_UNTIL?: string | undefined;
}>((environment) => {
  const cutoverAt = environment.CHECKOUT_RESERVATION_HMAC_CUTOVER_AT;
  const legacyReadUntil =
    environment.CHECKOUT_RESERVATION_HMAC_LEGACY_READ_UNTIL;

  if (cutoverAt === undefined && legacyReadUntil === undefined) {
    return undefined;
  }
  if (
    cutoverAt === undefined ||
    legacyReadUntil === undefined ||
    environment.CHECKOUT_RESERVATION_HMAC_SECRET === undefined
  ) {
    return {
      path: ["CHECKOUT_RESERVATION_HMAC_CUTOVER_AT"],
      issue:
        "Checkout reservation HMAC cutover requires dedicated material and both rollout instants.",
    };
  }
  if (Date.parse(legacyReadUntil) <= Date.parse(cutoverAt)) {
    return {
      path: ["CHECKOUT_RESERVATION_HMAC_LEGACY_READ_UNTIL"],
      issue: "Checkout reservation HMAC legacy reads must end after cutover.",
    };
  }

  return undefined;
});

export const workspaceServerEnvSchema = Schema.Struct({
  CLOUDINARY_API_KEY: nonEmptyStringSchema,
  CLOUDINARY_API_SECRET: nonEmptyStringSchema,
  DATABASE_URL: urlEnvSchema,
  DATABASE_URL_UNPOOLED: optionalUrlEnvSchema,
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
  GOOGLE_CALENDAR_PRIVATE_KEY: nonEmptyStringSchema,
  GOOGLE_CALENDAR_SALES_ID: nonEmptyStringSchema,
  GOOGLE_CALENDAR_SERVICE_ACCOUNT_EMAIL: nonEmptyStringSchema,
  GOOGLE_CALENDAR_WORKSPACE_LIMITATIONS_ID: nonEmptyStringSchema,
  RESEND_WEBHOOK_SECRET: optionalStringSchema,
  CHECKOUT_PAY_STATE_KEYS: nonEmptyStringSchema,
  CHECKOUT_RESERVATION_HMAC_SECRET: optionalCheckoutHmacSecretSchema,
  CHECKOUT_RESERVATION_HMAC_CUTOVER_AT: optionalUtcInstantSchema,
  CHECKOUT_RESERVATION_HMAC_LEGACY_READ_UNTIL: optionalUtcInstantSchema,
  CHECKOUT_RETURN_STATE_TOKEN_SECRET: toEnvSchema(
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
  POSTHOG_FEATURE_FLAG_OVERRIDES: toEnvSchema(
    postHogFeatureFlagOverridesSchema
  ),
  VERCEL_ENV: toEnvSchema(vercelEnvironmentSchema),
  VERCEL_GIT_COMMIT_SHA: optionalStringSchema,
  VERCEL_AUTOMATION_BYPASS_SECRET: optionalStringSchema,
  VERCEL_PROJECT_PRODUCTION_URL: nonEmptyStringSchema,
  VERCEL_URL: nonEmptyStringSchema,
})
  .check(postHogFeatureFlagOverridesEnvironmentCheck)
  .check(checkoutReservationHmacEnvironmentCheck);

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
  const schema = Schema.Struct(fields);

  return Schema.toStandardSchemaV1(
    isServer
      ? schema
          .check(postHogFeatureFlagOverridesEnvironmentCheck)
          .check(checkoutReservationHmacEnvironmentCheck)
      : schema
  );
};

export type WorkspaceServerEnv = Schema.Schema.Type<
  typeof workspaceServerEnvSchema
>;
export type WorkspaceClientEnv = Schema.Schema.Type<
  typeof workspaceClientEnvSchema
>;
