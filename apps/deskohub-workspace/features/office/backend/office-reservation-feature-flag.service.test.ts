import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import { PostHogFeatureFlagEvaluationError } from "@deskohub/posthog/feature-flags/node";
import { Effect, Logger } from "effect";
import { WorkspaceFeatureFlagServiceMock } from "@/features/feature-flags/backend/workspace-feature-flag.service.mock";
import { OfficeReservationFeatureFlagService } from "./office-reservation-feature-flag.service";

describe("OfficeReservationFeatureFlagService", () => {
  test("fails closed when PostHog runtime evaluation is unavailable", async () => {
    const isEnabled = mock(() =>
      Effect.fail(
        new PostHogFeatureFlagEvaluationError({
          message: "Evaluation failed.",
          cause: new Error("PostHog unavailable"),
        })
      )
    );
    const logLevels: string[] = [];
    const logger = Logger.make((options) => {
      logLevels.push(options.logLevel);
    });

    const enabled = await Effect.gen(function* () {
      const featureFlag = yield* OfficeReservationFeatureFlagService;
      return yield* featureFlag.isEnabled;
    }).pipe(
      Effect.provide(OfficeReservationFeatureFlagService.Default),
      Effect.provide(WorkspaceFeatureFlagServiceMock({ isEnabled })),
      Effect.provide(Logger.layer([logger])),
      Effect.runPromise
    );

    expect(enabled).toBe(false);
    expect(isEnabled).toHaveBeenCalledWith("office_page");
    expect(logLevels).toContain("Warn");
  });
});
