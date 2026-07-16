import { generatePostHogFeatureFlagContract } from "@deskohub/posthog/feature-flags/codegen";
import { Effect } from "effect";
import { env } from "@/env";
import { runWorkspaceEffect } from "@/shared/backend/logging/censorship";

const syncPostHogFeatureFlags = generatePostHogFeatureFlagContract({
  apiKey: env.POSTHOG_FEATURE_FLAGS_API_KEY,
  host: env.POSTHOG_HOST,
  outputFile: new URL(
    "../features/feature-flags/generated/contract.ts",
    import.meta.url
  ),
  projectId: env.POSTHOG_PROJECT_ID,
}).pipe(
  Effect.tap((result) =>
    Effect.logInfo("Workspace PostHog feature flags synchronized", {
      flagCount: result.flagCount,
      status: result.status,
    })
  )
);

if (import.meta.main) runWorkspaceEffect(syncPostHogFeatureFlags);
