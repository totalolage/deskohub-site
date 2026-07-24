import { describe, expect, test } from "bun:test";
import { Effect, Exit } from "effect";
import { makeTestE2EEnvironment } from "./e2e-env.test-fixture";
import { makeE2ETelemetryRuntime, runE2EEffect } from "./telemetry-runtime";

describe("E2E telemetry runtime", () => {
  test("keeps local E2E runnable without PostHog configuration", async () => {
    const runtime = makeE2ETelemetryRuntime(makeTestE2EEnvironment());

    expect(runtime.telemetryEnabled).toBe(false);
    await expect(Effect.runPromise(runtime.shutdown)).resolves.toBeUndefined();
  });

  test("accepts the dedicated E2E PostHog configuration", async () => {
    const runtime = makeE2ETelemetryRuntime(
      makeTestE2EEnvironment({
        WORKSPACE_E2E_POSTHOG_HOST: "https://us.i.posthog.com",
        WORKSPACE_E2E_POSTHOG_PROJECT_TOKEN: "phc_test",
      })
    );

    expect(runtime.telemetryEnabled).toBe(true);
    await expect(Effect.runPromise(runtime.shutdown)).resolves.toBeUndefined();
  });

  test("returns the suite failure after the telemetry lifecycle finishes", async () => {
    const runtime = makeE2ETelemetryRuntime(makeTestE2EEnvironment());
    const exit = await runE2EEffect(Effect.fail("suite failed"), runtime);

    expect(Exit.isFailure(exit)).toBe(true);
  });
});
