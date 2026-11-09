import "server-only";

import type { PostHogFeatureFlagOverrides } from "@deskohub/posthog/feature-flags";
import {
  loadPostHogFeatureFlagDefinitions,
  type PostHogFeatureFlagDefinition,
} from "@deskohub/posthog/feature-flags/management";
import { Effect } from "effect";
import { cacheLife } from "next/cache";
import { env } from "@/env";
import { postHogRuntimeConfig } from "@/shared/backend/config/posthog.config";
import { readSharedSnapshot } from "@/shared/backend/shared-snapshot";
import {
  type PostHogFeatureFlagDefinitions,
  type PostHogFeatureFlagKey,
  postHogFeatureFlags,
} from "../generated/contract";

type GlobalWorkspaceFeatureFlagValues =
  PostHogFeatureFlagOverrides<PostHogFeatureFlagDefinitions>;

/** Returns the requested values only when every requested flag is constant. */
export async function getGlobalWorkspaceFeatureFlagValues(
  keys: readonly PostHogFeatureFlagKey[]
): Promise<GlobalWorkspaceFeatureFlagValues | undefined> {
  const values = await classifyWorkspaceFeatureFlags();
  if (!keys.every((key) => Object.hasOwn(values, key))) return undefined;

  return Object.fromEntries(keys.map((key) => [key, values[key]]));
}

export async function getGlobalWorkspaceFeatureFlagValue(
  key: PostHogFeatureFlagKey
) {
  return (await classifyWorkspaceFeatureFlags())[key];
}

interface ClassifiedDefinitions {
  readonly definitions: ReadonlyArray<PostHogFeatureFlagDefinition>;
  /** False when PostHog couldn't answer with the management definitions. */
  readonly complete: boolean;
}

async function classifyWorkspaceFeatureFlags(): Promise<GlobalWorkspaceFeatureFlagValues> {
  "use cache";

  const overrides = postHogRuntimeConfig.featureFlagOverrides ?? {};
  const apiKey = env.POSTHOG_API_KEY;
  const host = env.POSTHOG_API_HOST;
  const projectId = env.POSTHOG_PROJECT_ID;
  if (!(apiKey && host && projectId)) {
    cacheLife("publicContent");
    return overrides;
  }

  const { definitions } = await readSharedSnapshot(
    "feature-flags.classify",
    Effect.suspend(() =>
      loadPostHogFeatureFlagDefinitions({
        apiKey,
        host: new URL(host),
        projectId,
      })
    ).pipe(
      Effect.map(
        (definitions): ClassifiedDefinitions => ({
          definitions,
          complete: true,
        })
      ),
      // Without the definitions only the overrides are constant.
      Effect.catch((error) =>
        Effect.logWarning(error.message, { cause: error.cause }).pipe(
          Effect.as<ClassifiedDefinitions>({ definitions: [], complete: false })
        )
      )
    ),
    {
      complete: { lifetime: "publicContent" },
      // Shared as long as a complete classification.
      incomplete: {
        when: ({ complete }) => !complete,
        lifetime: "publicContent",
      },
    }
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
