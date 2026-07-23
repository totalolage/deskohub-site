import type { PostHogFeatureFlagOverrides } from "@deskohub/posthog/feature-flags";
import { Schema, SchemaGetter } from "effect";
import {
  type PostHogFeatureFlagDefinitions,
  postHogFeatureFlags,
} from "./generated/contract";

export const vercelEnvironmentSchema = Schema.Literals([
  "production",
  "preview",
  "development",
]);

const postHogFeatureFlagKeySet = new Set<string>(postHogFeatureFlags.keys);
const postHogFeatureFlagOverridesObjectSchema = Schema.Record(
  Schema.Literals(postHogFeatureFlags.keys),
  Schema.optional(Schema.Boolean)
);
const decodedPostHogFeatureFlagOverridesSchema = Schema.Record(
  Schema.String,
  Schema.Boolean
)
  .check(
    Schema.makeFilter((overrides) =>
      Object.keys(overrides).every((key) => postHogFeatureFlagKeySet.has(key))
        ? undefined
        : "Feature flag overrides contain an unknown flag key."
    )
  )
  .pipe(Schema.decodeTo(postHogFeatureFlagOverridesObjectSchema));

export const postHogFeatureFlagOverridesSchema = Schema.optional(
  Schema.Union([
    Schema.Literal(""),
    Schema.fromJsonString(decodedPostHogFeatureFlagOverridesSchema),
  ])
).pipe(
  Schema.decodeTo(Schema.optional(postHogFeatureFlagOverridesObjectSchema), {
    decode: SchemaGetter.transform((overrides) =>
      overrides === "" ||
      (overrides !== undefined && Object.keys(overrides).length === 0)
        ? undefined
        : overrides
    ),
    encode: SchemaGetter.transform((overrides) => overrides),
  })
);

export const postHogFeatureFlagOverridesEnvironmentCheck = Schema.makeFilter<{
  readonly POSTHOG_FEATURE_FLAG_OVERRIDES?:
    | PostHogFeatureFlagOverrides<PostHogFeatureFlagDefinitions>
    | undefined;
  readonly VERCEL_ENV: "production" | "preview" | "development";
}>((environment) =>
  environment.VERCEL_ENV === "production" &&
  environment.POSTHOG_FEATURE_FLAG_OVERRIDES !== undefined
    ? {
        path: ["POSTHOG_FEATURE_FLAG_OVERRIDES"],
        issue:
          "Feature flag overrides are only allowed in preview or development deployments.",
      }
    : undefined
);

export const postHogFeatureFlagOverrideEnvironmentSchema = Schema.Struct({
  POSTHOG_FEATURE_FLAG_OVERRIDES: postHogFeatureFlagOverridesSchema,
  VERCEL_ENV: vercelEnvironmentSchema,
}).check(postHogFeatureFlagOverridesEnvironmentCheck);
