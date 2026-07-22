import {
  generatePostHogFeatureFlagContract,
  PostHogFeatureFlagError,
} from "@deskohub/posthog/feature-flags/codegen";
import { Effect, Schema } from "effect";
import { runStandaloneWorkspaceEffect } from "@/shared/backend/standalone-workspace-effect";

const PostHogFeatureFlagGenerationEnv = Schema.Struct({
  POSTHOG_FEATURE_FLAGS_API_KEY: Schema.NonEmptyString,
  POSTHOG_HOST: Schema.URLFromString,
  POSTHOG_PROJECT_ID: Schema.NonEmptyString,
});

const loadPostHogFeatureFlagGenerationEnv = Schema.decodeUnknownEffect(
  PostHogFeatureFlagGenerationEnv
)({
  POSTHOG_FEATURE_FLAGS_API_KEY: process.env.POSTHOG_FEATURE_FLAGS_API_KEY,
  POSTHOG_HOST: process.env.POSTHOG_HOST ?? "https://eu.posthog.com",
  POSTHOG_PROJECT_ID: process.env.POSTHOG_PROJECT_ID,
}).pipe(
  Effect.mapError(
    (cause) =>
      new PostHogFeatureFlagError({
        message:
          "Invalid Workspace PostHog feature flag generation environment.",
        cause,
      })
  )
);

const syncPostHogFeatureFlags = Effect.Do.pipe(
  Effect.bind("env", () => loadPostHogFeatureFlagGenerationEnv),
  Effect.bind("result", ({ env }) =>
    generatePostHogFeatureFlagContract({
      apiKey: env.POSTHOG_FEATURE_FLAGS_API_KEY,
      host: env.POSTHOG_HOST,
      outputFile: new URL(
        "../features/feature-flags/generated/contract.ts",
        import.meta.url
      ),
      projectId: env.POSTHOG_PROJECT_ID,
    })
  ),
  Effect.tap(({ result }) =>
    Effect.logInfo("Workspace PostHog feature flags synchronized", {
      flagCount: result.flagCount,
      status: result.status,
    })
  ),
  Effect.map(({ result }) => result)
);

if (import.meta.main) {
  await syncPostHogFeatureFlags.pipe(
    runStandaloneWorkspaceEffect("feature-flags.sync")
  );
}
