import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { PostHogFeatureFlagEvaluationError } from "@deskohub/posthog/feature-flags/node";
import { Effect } from "effect";
import { WorkspaceFeatureFlagServiceMock } from "./workspace-feature-flag.service.mock";

describe("SeatingMapFeatureFlagService", () => {
  test("fails closed when PostHog runtime evaluation is unavailable", async () => {
    const { SeatingMapFeatureFlagService } = await import(
      "./seating-map-feature-flag.service"
    );
    const enabled = await Effect.gen(function* () {
      const featureFlag = yield* SeatingMapFeatureFlagService;
      return yield* featureFlag.isEnabled;
    }).pipe(
      Effect.provide(SeatingMapFeatureFlagService.Live),
      Effect.provide(
        WorkspaceFeatureFlagServiceMock({
          isEnabled: () =>
            Effect.fail(
              new PostHogFeatureFlagEvaluationError({
                message: "Evaluation failed.",
                cause: new Error("PostHog unavailable"),
              })
            ),
        })
      ),
      Effect.runPromise
    );

    expect(enabled).toBe(false);
  });
});
