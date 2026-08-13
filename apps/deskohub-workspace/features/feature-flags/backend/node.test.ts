import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import { PostHogDistinctId } from "@deskohub/posthog/identifiers";
import { Effect, Predicate } from "effect";

const overrideFeatureFlags = mock(<T>(_overrides: T) => undefined);

mock.module("posthog-node", () => ({
  cookieStoreFromHeader: (header: string) => {
    const cookies = new Map(
      header.split(";").flatMap((part) => {
        const separator = part.indexOf("=");
        if (separator < 0) return [];

        const name = part.slice(0, separator).trim();
        const value = part.slice(separator + 1).trim();
        return [[name, { name, value }] as const];
      })
    );

    return {
      get: (name: string) => cookies.get(name),
      getAll: () => [...cookies.values()],
      has: (name: string) => cookies.has(name),
      size: cookies.size,
    };
  },
  PostHog: function PostHog() {
    let overrides: Readonly<Record<string, boolean | string>> = {};
    const getFlag = (key: string) => overrides[key];
    const isEnabled = (key: string) => {
      const value = getFlag(key);
      return value !== undefined && value !== false;
    };

    return {
      evaluateFlags: () =>
        Promise.resolve({
          getFlag,
          getFlagPayload: () => undefined,
          isEnabled,
        }),
      getAllFlagsAndPayloads: () =>
        Promise.resolve({
          featureFlags: overrides,
          featureFlagPayloads: {},
        }),
      getFeatureFlagResult: (key: string) =>
        Promise.resolve({
          enabled: isEnabled(key),
          key,
          payload: undefined,
          variant: Predicate.isString(overrides[key])
            ? overrides[key]
            : undefined,
        }),
      overrideFeatureFlags: (
        configuredOverrides: Readonly<Record<string, boolean | string>>
      ) => {
        overrideFeatureFlags(configuredOverrides);
        overrides = configuredOverrides;
      },
      shutdown: () => Promise.resolve(),
    };
  },
}));

mock.module("@/shared/backend/config/posthog.config", () => ({
  postHogRuntimeConfig: {
    environment: "preview",
    featureFlagOverrides: { discount_codes: true },
    host: "https://posthog.example",
    projectToken: "phc_test",
    serviceName: "deskohub-workspace",
    serviceNamespace: "deskohub",
  },
}));

describe("Workspace PostHog Node feature flags", () => {
  test("passes the deployment override to server evaluations", async () => {
    const { nodeFeatureFlags } = await import("./node");

    const snapshot = await Effect.runPromise(
      nodeFeatureFlags.evaluateFlags({
        subject: {
          distinctId: PostHogDistinctId.make("global-release"),
          sendFeatureFlagEvents: false,
        },
      })
    );
    const enabled = await Effect.runPromise(
      nodeFeatureFlags.isEnabled({
        key: "discount_codes",
        subject: {
          distinctId: PostHogDistinctId.make("visitor-id"),
          sendFeatureFlagEvents: true,
        },
      })
    );

    expect(snapshot.getFlag("discount_codes")).toBeTrue();
    expect(snapshot.isEnabled("discount_codes")).toBeTrue();
    expect(enabled).toBeTrue();
    expect(overrideFeatureFlags).toHaveBeenCalledTimes(1);
    expect(overrideFeatureFlags).toHaveBeenCalledWith({
      discount_codes: true,
    });
  });
});
