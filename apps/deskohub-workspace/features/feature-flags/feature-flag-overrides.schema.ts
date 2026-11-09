import { Schema, SchemaGetter } from "effect";
import { postHogFeatureFlags } from "./generated/contract";

export const vercelEnvironmentSchema = Schema.Literals([
  "production",
  "preview",
  "development",
]);

/** Overrides for the generated contract's flags; decoding ignores other keys. */
export const contractFeatureFlagOverridesSchema = Schema.Record(
  Schema.Literals(postHogFeatureFlags.keys),
  Schema.optional(Schema.Boolean)
);

/**
 * Overrides as configured for the deployment. Contract flags are validated,
 * while other keys keep unvalidated values because a shared preview value may
 * name flags this build does not know yet; `resolveFeatureFlagOverrides` drops
 * those keys.
 */
const configuredFeatureFlagOverridesSchema = Schema.StructWithRest(
  contractFeatureFlagOverridesSchema,
  [Schema.Record(Schema.String, Schema.Unknown)]
);

export type ConfiguredFeatureFlagOverrides =
  typeof configuredFeatureFlagOverridesSchema.Type;

export const postHogFeatureFlagOverridesSchema = Schema.optional(
  Schema.Union([
    Schema.Literal(""),
    Schema.fromJsonString(configuredFeatureFlagOverridesSchema),
  ])
).pipe(
  Schema.decodeTo(Schema.optional(configuredFeatureFlagOverridesSchema), {
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
    | ConfiguredFeatureFlagOverrides
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
