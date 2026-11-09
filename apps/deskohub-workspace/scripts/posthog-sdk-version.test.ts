import { expect, test } from "bun:test";
import {
  expectedPosthogSdkVersion,
  readInstalledPosthogSdkVersion,
} from "./posthog-sdk-version";

// The PostHog identity browser check runs by hand, so this keeps its SDK
// preflight from drifting away from the pinned, installed posthog-js.
test("installs the pinned posthog-js version the identity check bundles", async () => {
  expect(await readInstalledPosthogSdkVersion()).toBe(
    expectedPosthogSdkVersion
  );
});
