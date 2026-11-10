import { describe, expect, mock, test } from "bun:test";

const constructedOptions: Record<string, unknown>[] = [];

class FakePostHog {
  constructor(_apiKey: string, options: Record<string, unknown>) {
    constructedOptions.push(options);
  }
  optIn() {
    return Promise.resolve();
  }
  register() {
    return Promise.resolve();
  }
}

mock.module("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: () => Promise.resolve(null),
    setItem: () => Promise.resolve(),
  },
}));
mock.module("posthog-react-native", () => ({
  default: FakePostHog,
  PostHogPersistedProperty: {},
}));

const { createPostHogClient } = await import("./posthog-client");

describe("createPostHogClient", () => {
  test.each([
    [true, false],
    [false, true],
  ])(
    "with remote flags %p, sets disableRemoteFeatureFlags to %p",
    (remoteFeatureFlags, disabled) => {
      constructedOptions.length = 0;
      createPostHogClient({
        apiKey: "phc_test",
        host: "https://t.example.test",
        remoteFeatureFlags,
        superProperties: {},
      });
      expect(constructedOptions[0]?.disableRemoteFeatureFlags).toBe(disabled);
    }
  );
});
