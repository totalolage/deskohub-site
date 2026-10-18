import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import { PostHogFeatureFlagEvaluationError } from "@deskohub/posthog/feature-flags/node";
import { Effect, Logger } from "effect";
import { WorkspaceFeatureFlagServiceMock } from "@/features/feature-flags/backend/workspace-feature-flag.service.mock";
import { MeetingRoomPageFeatureFlagService } from "./meeting-room-page-feature-flag.service";

describe("MeetingRoomPageFeatureFlagService", () => {
  test("fails closed and logs when PostHog evaluation is unavailable", async () => {
    const isEnabled = mock(() =>
      Effect.fail(
        new PostHogFeatureFlagEvaluationError({
          message: "Could not evaluate the PostHog feature flag.",
          cause: undefined,
        })
      )
    );
    const logRecords: { level: string; message: unknown }[] = [];
    const logger = Logger.make((options) => {
      logRecords.push({
        level: options.logLevel,
        message: options.message[0],
      });
    });

    const enabled = await Effect.gen(function* () {
      const featureFlag = yield* MeetingRoomPageFeatureFlagService;
      return yield* featureFlag.isEnabled;
    }).pipe(
      Effect.provide(MeetingRoomPageFeatureFlagService.Default),
      Effect.provide(WorkspaceFeatureFlagServiceMock({ isEnabled })),
      Effect.provide(Logger.layer([logger])),
      Effect.runPromise
    );

    expect(enabled).toBe(false);
    expect(isEnabled).toHaveBeenCalledWith("meeting_room_page");
    expect(logRecords).toContainEqual({
      level: "Warn",
      message: "Could not evaluate the PostHog feature flag.",
    });
  });
});
