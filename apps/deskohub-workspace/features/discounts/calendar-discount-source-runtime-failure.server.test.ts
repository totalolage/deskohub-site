import "@/shared/testing/workspace-test-env";
import "@/shared/polyfills/temporal";

import { expect, mock, spyOn, test } from "bun:test";
import { recordNextCache } from "@/shared/testing/next-cache-recorder.test-utils";
import { failWorkspaceTelemetry } from "@/shared/testing/workspace-telemetry.test-utils";

const runtimeBuildFailure = new Error(
  "synthetic PostHog logging configuration unusable"
);
const nextCache = recordNextCache();

// The shared runtime builds its observability layer before entering any
// Effect, so every run in this file fails before the Calendar load starts.
mock.module("next/cache", () => nextCache.module);
failWorkspaceTelemetry(runtimeBuildFailure);

const { loadCalendarDiscountSource } = await import(
  "./calendar-discount-source.server"
);

test("marks the Calendar sale source uncacheable when the runner cannot start", async () => {
  const warn = spyOn(console, "warn").mockImplementation(() => undefined);

  try {
    await expect(loadCalendarDiscountSource("2026-07-14")).rejects.toBe(
      runtimeBuildFailure
    );
    expect(nextCache.calls).toEqual([{ cacheLife: { expire: 0 } }]);
    // The rejection reaches callers that already log it, so the runner
    // must not log it again.
    expect(warn.mock.calls.flat().join(" ")).not.toContain(
      "calendar_discount_source_load_failed"
    );
  } finally {
    warn.mockRestore();
  }
});
