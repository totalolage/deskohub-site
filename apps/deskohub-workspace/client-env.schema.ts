import { Schema } from "effect";
import { urlStringSchema } from "./shared/utils/url-schema";

export const toEnvSchema = <S extends Schema.Decoder<unknown>>(schema: S) =>
  Schema.toStandardSchemaV1(schema);

export const optionalStringSchema = toEnvSchema(Schema.optional(Schema.String));
export const optionalUrlEnvSchema = toEnvSchema(
  Schema.optional(urlStringSchema)
);

export const postHogBrowserEnvironmentCheck = Schema.makeFilter<{
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

/**
 * Browser-visible environment. Kept apart from the server schema so browser
 * bundles never import server-only validation dependencies.
 */
export const workspaceClientEnvSchema = Schema.Struct({
  NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME: toEnvSchema(Schema.String),
  NEXT_PUBLIC_GTM_ID: optionalStringSchema,
  NEXT_PUBLIC_POSTHOG_HOST: optionalUrlEnvSchema,
  NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: toEnvSchema(
    Schema.optional(Schema.NonEmptyString)
  ),
  NEXT_PUBLIC_VERCEL_ENV: toEnvSchema(
    Schema.optional(Schema.Literals(["production", "preview", "development"]))
  ),
}).check(postHogBrowserEnvironmentCheck);
