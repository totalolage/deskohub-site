import {
  generatePostHogFeatureFlagContract,
  PostHogFeatureFlagError,
} from "@deskohub/posthog/feature-flags/codegen";
import { Effect, Schema } from "effect";
import { env } from "@/env";
import { runWorkspaceEffect } from "@/shared/backend/logging/censorship";

const PostHogFeatureFlagGenerationEnv = Schema.Struct({
  POSTHOG_FEATURE_FLAGS_API_KEY: Schema.NonEmptyString,
  POSTHOG_HOST: Schema.URLFromString,
  POSTHOG_PROJECT_ID: Schema.NonEmptyString,
});

const loadPostHogFeatureFlagGenerationEnv = Schema.decodeUnknownEffect(
  PostHogFeatureFlagGenerationEnv
)({
  POSTHOG_FEATURE_FLAGS_API_KEY: env.POSTHOG_FEATURE_FLAGS_API_KEY,
  POSTHOG_HOST: env.POSTHOG_HOST,
  POSTHOG_PROJECT_ID: env.POSTHOG_PROJECT_ID,
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

const program = Effect.Do.pipe(
  Effect.bind("generationEnv", () => loadPostHogFeatureFlagGenerationEnv),
  Effect.bind("result", ({ generationEnv }) =>
    generatePostHogFeatureFlagContract({
      apiKey: generationEnv.POSTHOG_FEATURE_FLAGS_API_KEY,
      host: generationEnv.POSTHOG_HOST,
      outputFile: new URL(
        "../features/feature-flags/generated/contract.ts",
        import.meta.url
      ),
      projectId: generationEnv.POSTHOG_PROJECT_ID,
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

if (import.meta.main) runWorkspaceEffect(program);
