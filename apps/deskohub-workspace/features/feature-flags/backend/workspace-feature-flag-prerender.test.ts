import "@/shared/testing/workspace-test-env";

import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { PostHogFeatureFlagOverrides } from "@deskohub/posthog/feature-flags";
import type { PostHogFeatureFlagDefinition } from "@deskohub/posthog/feature-flags/management";
import { Effect } from "effect";
import type { PostHogFeatureFlagDefinitions } from "@/features/feature-flags/generated/contract";

const env = {
  POSTHOG_API_HOST: undefined as string | undefined,
  POSTHOG_API_KEY: undefined as string | undefined,
  POSTHOG_PROJECT_ID: undefined as string | undefined,
};
const postHogRuntimeConfig = {
  featureFlagOverrides: undefined as
    | PostHogFeatureFlagOverrides<PostHogFeatureFlagDefinitions>
    | undefined,
};
let definitions: readonly PostHogFeatureFlagDefinition[] = [];

const loadPostHogFeatureFlagDefinitions = mock(() =>
  Effect.succeed(definitions)
);
const cacheLife = mock(() => undefined);
const evaluateFlags = mock(() =>
  Effect.fail(new Error("Unexpected whole-snapshot evaluation"))
);
const isEnabled = mock(() =>
  Effect.fail(new Error("Unexpected SDK evaluation"))
);
const getCurrentPostHogFeatureFlagSubject = mock(() =>
  Effect.fail(new Error("Unexpected request subject lookup"))
);

mock.module("@deskohub/posthog/feature-flags/management", () => ({
  loadPostHogFeatureFlagDefinitions,
}));
mock.module("@/env", () => ({ env }));
mock.module("@/shared/backend/config/posthog.config", () => ({
  postHogRuntimeConfig,
}));
mock.module("next/cache", () => ({ cacheLife }));
mock.module("@/shared/backend/workspace-effect", () => ({
  runWorkspaceEffect:
    (_operation: string) =>
    <A, E>(effect: Effect.Effect<A, E, never>): Promise<A> =>
      Effect.runPromise(effect),
}));
mock.module("@/features/feature-flags/backend/node", () => ({
  nodeFeatureFlags: { evaluateFlags, isEnabled },
}));
mock.module("@/features/feature-flags/backend/subject", () => ({
  getCurrentPostHogFeatureFlagSubject,
  workspaceReleaseSubject: {
    distinctId: "synthetic-release",
    sendFeatureFlagEvents: false,
  },
}));

const { WorkspaceFeatureFlagService } = await import(
  "./workspace-feature-flag.service"
);

const makeDefinition = (
  constantEnabledValue: boolean
): PostHogFeatureFlagDefinition => ({
  constantEnabledValue,
  key: "discount_codes",
  payloads: {},
  variants: [],
});

const readFlag = () =>
  Effect.gen(function* () {
    const featureFlags = yield* WorkspaceFeatureFlagService;
    return yield* featureFlags.isEnabled("discount_codes");
  }).pipe(
    Effect.provide(WorkspaceFeatureFlagService.Default),
    Effect.runPromise
  );

const expectNoRequestDependentEvaluation = () => {
  expect(evaluateFlags).not.toHaveBeenCalled();
  expect(isEnabled).not.toHaveBeenCalled();
  expect(getCurrentPostHogFeatureFlagSubject).not.toHaveBeenCalled();
};

describe("WorkspaceFeatureFlagService prerender evaluation", () => {
  beforeEach(() => {
    definitions = [];
    env.POSTHOG_API_HOST = undefined;
    env.POSTHOG_API_KEY = undefined;
    env.POSTHOG_PROJECT_ID = undefined;
    postHogRuntimeConfig.featureFlagOverrides = undefined;
    loadPostHogFeatureFlagDefinitions.mockClear();
    cacheLife.mockClear();
    evaluateFlags.mockClear();
    isEnabled.mockClear();
    getCurrentPostHogFeatureFlagSubject.mockClear();
  });

  test.each([true, false])(
    "uses a constant %s management definition without request-dependent evaluation",
    async (enabled) => {
      definitions = [makeDefinition(enabled)];
      env.POSTHOG_API_HOST = "https://posthog.example";
      env.POSTHOG_API_KEY = "synthetic-management-key";
      env.POSTHOG_PROJECT_ID = "synthetic-project";

      await expect(readFlag()).resolves.toBe(enabled);

      expect(loadPostHogFeatureFlagDefinitions).toHaveBeenCalledTimes(1);
      expect(cacheLife).toHaveBeenCalledWith("publicContent");
      expectNoRequestDependentEvaluation();
    }
  );

  test("uses a true preview override over a constant false management definition", async () => {
    definitions = [makeDefinition(false)];
    env.POSTHOG_API_HOST = "https://posthog.example";
    env.POSTHOG_API_KEY = "synthetic-management-key";
    env.POSTHOG_PROJECT_ID = "synthetic-project";
    postHogRuntimeConfig.featureFlagOverrides = { discount_codes: true };

    await expect(readFlag()).resolves.toBe(true);

    expect(loadPostHogFeatureFlagDefinitions).toHaveBeenCalledTimes(1);
    expect(cacheLife).toHaveBeenCalledWith("publicContent");
    expectNoRequestDependentEvaluation();
  });

  test.each([true, false])(
    "uses a preview %s override without management configuration or request-dependent evaluation",
    async (enabled) => {
      postHogRuntimeConfig.featureFlagOverrides = { discount_codes: enabled };

      await expect(readFlag()).resolves.toBe(enabled);

      expect(loadPostHogFeatureFlagDefinitions).not.toHaveBeenCalled();
      expect(cacheLife).toHaveBeenCalledWith("publicContent");
      expectNoRequestDependentEvaluation();
    }
  );
});
