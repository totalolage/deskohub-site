import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import { Effect } from "effect";

mock.module("server-only", () => ({}));

const evaluateFlags = mock(() =>
  Promise.resolve({
    getFlag: () => true,
    getFlagPayload: () => undefined,
    isEnabled: () => true,
  })
);
const shutdown = mock(() => Promise.resolve());
const createClient = mock(() => undefined);

mock.module("posthog-node", () => ({
  PostHog: class {
    constructor() {
      createClient();
    }

    evaluateFlags = evaluateFlags;
    shutdown = shutdown;
  },
}));

const config = {
  environment: "test",
  host: "https://posthog.example",
  projectToken: "phc_test",
  serviceName: "workspace-test",
  serviceNamespace: "deskohub-test",
};

describe("FeatureFlagService", () => {
  test("evaluates a generated flag and closes the PostHog client", async () => {
    const { FeatureFlagService } = await import("./feature-flag.service");
    const { PostHogRuntimeConfigMock } = await import(
      "@/shared/backend/config/posthog.config.mock"
    );

    const enabled = await Effect.runPromise(
      FeatureFlagService.pipe(
        Effect.flatMap((featureFlags) =>
          featureFlags.isEnabled({
            distinctId: "public-site",
            key: "meeting_room_page",
          })
        ),
        Effect.provide(FeatureFlagService.Live),
        Effect.provide(PostHogRuntimeConfigMock(config))
      )
    );

    expect(enabled).toBeTrue();
    expect(evaluateFlags).toHaveBeenCalledWith("public-site", {
      disableGeoip: true,
      flagKeys: ["meeting_room_page"],
      groupProperties: undefined,
      groups: undefined,
      onlyEvaluateLocally: undefined,
      personProperties: undefined,
    });
    expect(shutdown).toHaveBeenCalledTimes(1);
  });

  test("fails closed without constructing a client when PostHog is not configured", async () => {
    const { FeatureFlagService } = await import("./feature-flag.service");
    const { PostHogRuntimeConfigMock } = await import(
      "@/shared/backend/config/posthog.config.mock"
    );
    createClient.mockClear();

    const enabled = await Effect.runPromise(
      FeatureFlagService.pipe(
        Effect.flatMap((featureFlags) =>
          featureFlags.isEnabled({
            distinctId: "public-site",
            key: "meeting_room_page",
          })
        ),
        Effect.provide(FeatureFlagService.Live),
        Effect.provide(
          PostHogRuntimeConfigMock({ ...config, projectToken: undefined })
        )
      )
    );

    expect(enabled).toBeFalse();
    expect(createClient).not.toHaveBeenCalled();
  });
});
