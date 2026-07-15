import { createEnv } from "@t3-oss/env-core";
import { Effect, Layer, Schema } from "effect";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import { PostHogFeatureFlagConfig } from "../src/feature-flags/config";
import { PostHogFeatureFlagService } from "../src/feature-flags/definitions";
import { PostHogFeatureFlagError } from "../src/feature-flags/errors";
import {
  PostHogFeatureFlagContractFile,
  PostHogFeatureFlagSync,
  runPostHogFeatureFlagSync,
} from "../src/feature-flags/sync";

const mode = process.argv.includes("--check") ? "check" : "sync";

export const loadPostHogFeatureFlagEnv = (runtimeEnv: {
  readonly POSTHOG_FEATURE_FLAGS_API_KEY?: string;
  readonly POSTHOG_HOST?: string;
  readonly POSTHOG_PROJECT_ID?: string;
}) =>
  Effect.try({
    try: () =>
      createEnv({
        server: {
          POSTHOG_FEATURE_FLAGS_API_KEY: Schema.toStandardSchemaV1(
            Schema.NonEmptyString
          ),
          POSTHOG_HOST: Schema.toStandardSchemaV1(Schema.URLFromString),
          POSTHOG_PROJECT_ID: Schema.toStandardSchemaV1(Schema.NonEmptyString),
        },
        runtimeEnv: {
          POSTHOG_FEATURE_FLAGS_API_KEY:
            runtimeEnv.POSTHOG_FEATURE_FLAGS_API_KEY,
          POSTHOG_HOST: runtimeEnv.POSTHOG_HOST || "https://eu.posthog.com",
          POSTHOG_PROJECT_ID: runtimeEnv.POSTHOG_PROJECT_ID,
        },
        emptyStringAsUndefined: true,
        onValidationError: (issues) => {
          throw new Error("Invalid PostHog feature flag sync environment.", {
            cause: issues,
          });
        },
      }),
    catch: (cause) =>
      new PostHogFeatureFlagError({
        message: "Invalid PostHog feature flag sync environment.",
        cause,
      }),
  });

const program = Effect.gen(function* () {
  const env = yield* loadPostHogFeatureFlagEnv({
    POSTHOG_FEATURE_FLAGS_API_KEY: process.env.POSTHOG_FEATURE_FLAGS_API_KEY,
    POSTHOG_HOST: process.env.POSTHOG_HOST,
    POSTHOG_PROJECT_ID: process.env.POSTHOG_PROJECT_ID,
  });
  const featureFlagServiceLive = PostHogFeatureFlagService.Live.pipe(
    Layer.provide(
      PostHogFeatureFlagConfig.from({
        apiKey: env.POSTHOG_FEATURE_FLAGS_API_KEY,
        host: env.POSTHOG_HOST,
        projectId: env.POSTHOG_PROJECT_ID,
      })
    ),
    Layer.provide(FetchHttpClient.layer)
  );
  const featureFlagSyncLive = PostHogFeatureFlagSync.Live.pipe(
    Layer.provide(
      Layer.merge(featureFlagServiceLive, PostHogFeatureFlagContractFile.Live)
    )
  );

  return yield* runPostHogFeatureFlagSync(mode).pipe(
    Effect.tap((result) =>
      Effect.logInfo("PostHog feature flag types synchronized", {
        flagCount: result.flagCount,
        status: result.status,
      })
    ),
    Effect.provide(featureFlagSyncLive)
  );
});

if (import.meta.main) {
  Effect.runPromise(program);
}
