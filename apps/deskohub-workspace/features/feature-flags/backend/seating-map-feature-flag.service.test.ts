import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { Effect } from "effect";

describe("SeatingMapFeatureFlagService", () => {
  test("fails closed when PostHog runtime evaluation is unavailable", async () => {
    const { SeatingMapFeatureFlagService } = await import(
      "./seating-map-feature-flag.service"
    );
    const enabled = await Effect.gen(function* () {
      const featureFlag = yield* SeatingMapFeatureFlagService;
      return yield* featureFlag.isEnabled();
    }).pipe(
      Effect.provide(SeatingMapFeatureFlagService.Live),
      Effect.runPromise
    );

    expect(enabled).toBe(false);
  });
});
