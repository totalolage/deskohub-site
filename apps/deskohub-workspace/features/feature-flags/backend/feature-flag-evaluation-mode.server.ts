import "server-only";

import { loadPostHogFeatureFlagDefinitions } from "@deskohub/posthog/feature-flags/management";
import { Effect } from "effect";
import { cacheLife } from "next/cache";
import { env } from "@/env";
import { postHogRuntimeConfig } from "@/shared/backend/config/posthog.config";
import { readSharedSnapshot } from "@/shared/backend/shared-snapshot";
import type { PostHogFeatureFlagKey } from "../generated/contract";
import { postHogFeatureFlagSnapshot } from "../generated/flag-snapshot";
import {
  type ConstantFeatureFlagValues,
  makeFeatureFlagClassifier,
} from "./feature-flag-classification";

/** Returns the requested values only when every requested flag is constant. */
export async function getGlobalWorkspaceFeatureFlagValues(
  keys: readonly PostHogFeatureFlagKey[]
): Promise<ConstantFeatureFlagValues | undefined> {
  const values = await classifyWorkspaceFeatureFlags();
  if (!keys.every((key) => Object.hasOwn(values, key))) return undefined;

  return Object.fromEntries(keys.map((key) => [key, values[key]]));
}

export async function getGlobalWorkspaceFeatureFlagValue(
  key: PostHogFeatureFlagKey
) {
  return (await classifyWorkspaceFeatureFlags())[key];
}

/** Remembers this process's last complete classification across refreshes. */
const classifyFeatureFlags = makeFeatureFlagClassifier({
  snapshot: postHogFeatureFlagSnapshot,
});

async function classifyWorkspaceFeatureFlags(): Promise<ConstantFeatureFlagValues> {
  "use cache";

  const overrides = postHogRuntimeConfig.featureFlagOverrides ?? {};
  const apiKey = env.POSTHOG_API_KEY;
  const host = env.POSTHOG_API_HOST;
  const projectId = env.POSTHOG_PROJECT_ID;
  if (!(apiKey && host && projectId)) {
    cacheLife("publicContent");
    return overrides;
  }

  const { values } = await readSharedSnapshot(
    "feature-flags.classify",
    classifyFeatureFlags({
      definitions: Effect.suspend(() =>
        loadPostHogFeatureFlagDefinitions({
          apiKey,
          host: new URL(host),
          projectId,
        })
      ),
      overrides,
    }),
    // Every source refreshes on the same cadence: a failed refresh serves
    // the last complete classification or the snapshot until the next one.
    { complete: { lifetime: "publicContent" } }
  );

  return values;
}
