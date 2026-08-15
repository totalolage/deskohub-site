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
  const globalKeys = new Set(await getGlobalWorkspaceFeatureFlagKeys());
  return keys.every((key) => globalKeys.has(key));
}

async function getGlobalWorkspaceFeatureFlagKeys() {
  "use cache";
  cacheLife("globalRelease");

  const overriddenKeys = postHogFeatureFlags.keys.filter((key) =>
    Object.hasOwn(postHogRuntimeConfig.featureFlagOverrides ?? {}, key)
  );
  const apiKey = env.POSTHOG_API_KEY;
  const host = env.POSTHOG_HOST;
  const projectId = env.POSTHOG_PROJECT_ID;
  if (!(apiKey && host && projectId)) return overriddenKeys;

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

  return [
    ...new Set([
      ...overriddenKeys,
      ...definitions.flatMap(({ constantEnabledValue, key }) =>
        constantEnabledValue === undefined ? [] : [key]
      ),
    ]),
  ].filter((key): key is PostHogFeatureFlagKey =>
    postHogFeatureFlags.keys.includes(key as PostHogFeatureFlagKey)
  );
}
