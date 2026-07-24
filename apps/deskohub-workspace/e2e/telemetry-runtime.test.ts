import { describe, expect, test } from "bun:test";
import { makeE2ETelemetryRuntime } from "./telemetry-runtime";

describe("E2E telemetry runtime", () => {
  test("keeps local E2E runnable without PostHog configuration", async () => {
    const runtime = makeE2ETelemetryRuntime({});

    expect(runtime.telemetryEnabled).toBe(false);
    await expect(runtime.shutdown()).resolves.toBeUndefined();
  });

  test("accepts the dedicated E2E PostHog configuration", async () => {
    const runtime = makeE2ETelemetryRuntime({
      WORKSPACE_E2E_POSTHOG_HOST: "https://us.i.posthog.com",
      WORKSPACE_E2E_POSTHOG_PROJECT_TOKEN: "phc_test",
    });

    expect(runtime.telemetryEnabled).toBe(true);
    await expect(runtime.shutdown()).resolves.toBeUndefined();
  });
});
