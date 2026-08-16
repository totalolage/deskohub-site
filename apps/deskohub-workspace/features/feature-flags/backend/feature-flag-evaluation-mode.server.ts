import "server-only";

import { loadPostHogFeatureFlagDefinitions } from "@deskohub/posthog/feature-flags/management";
import { Effect } from "effect";
import { cacheLife } from "next/cache";
import { env } from "@/env";
import { postHogRuntimeConfig } from "@/shared/backend/config/posthog.config";
import { runWorkspaceEffect } from "@/shared/backend/workspace-effect";
import {
  type PostHogFeatureFlagKey,
  postHogFeatureFlags,
} from "../generated/contract";

export async function areWorkspaceFeatureFlagsGlobal(
  keys: readonly PostHogFeatureFlagKey[]
) {
  const values = await getGlobalWorkspaceFeatureFlagValues();
  return keys.every((key) => Object.hasOwn(values, key));
}

export async function getGlobalWorkspaceFeatureFlagValue(
  key: PostHogFeatureFlagKey
) {
  return (await getGlobalWorkspaceFeatureFlagValues())[key];
}

async function getGlobalWorkspaceFeatureFlagValues() {
  "use cache";
  cacheLife("publicContent");

  const overrides = postHogRuntimeConfig.featureFlagOverrides ?? {};
  const apiKey = env.POSTHOG_API_KEY;
  const host = env.POSTHOG_API_HOST;
  const projectId = env.POSTHOG_PROJECT_ID;
  if (!(apiKey && host && projectId)) return overrides;

  const definitions = await loadPostHogFeatureFlagDefinitions({
    apiKey,
    host: new URL(host),
    projectId,
  }).pipe(
    Effect.catch((error) =>
      Effect.logWarning(error.message, { cause: error.cause }).pipe(
        Effect.as([])
      )
    ),
    runWorkspaceEffect("feature-flags.classify")
  );

  const values: Partial<Record<PostHogFeatureFlagKey, boolean>> = {};
  for (const { constantEnabledValue, key } of definitions) {
    if (
      constantEnabledValue !== undefined &&
      postHogFeatureFlags.keys.includes(key as PostHogFeatureFlagKey)
    ) {
      values[key as PostHogFeatureFlagKey] = constantEnabledValue;
    }
  }

  return { ...values, ...overrides };
}
