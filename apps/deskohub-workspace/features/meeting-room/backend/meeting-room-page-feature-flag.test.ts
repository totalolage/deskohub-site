import "@/shared/testing/workspace-test-env";

import { afterAll, afterEach, describe, expect, mock, test } from "bun:test";
import { PostHogFeatureFlagEvaluationError } from "@deskohub/posthog/feature-flags/node";
import { Effect, Layer, Logger } from "effect";
import {
  type IWorkspaceFeatureFlagService,
  WorkspaceFeatureFlagService,
} from "@/features/feature-flags/backend";

type LogRecord = {
  readonly level: string;
  readonly message: unknown;
};

const logRecords: LogRecord[] = [];
const logger = Logger.make((options) => {
  logRecords.push({
    level: options.logLevel,
    message: options.message[0],
  });
});

mock.module("@/shared/backend/workspace-effect", () => ({
  runWorkspaceEffect:
    () =>
    <A, E>(effect: Effect.Effect<A, E, never>): Promise<A> =>
      Effect.runPromise(effect.pipe(Effect.provide(Logger.layer([logger])))),
}));

const { isMeetingRoomPageEnabled } = await import(
  "./meeting-room-page-feature-flag"
);

const originalDefault = WorkspaceFeatureFlagService.Default;

const installFeatureFlagDefault = (
  isEnabled: IWorkspaceFeatureFlagService["isEnabled"]
) => {
  Object.assign(WorkspaceFeatureFlagService, {
    Default: Layer.succeed(WorkspaceFeatureFlagService, {
      evaluateFlags: () => Effect.die("evaluateFlags should not be called"),
      isEnabled,
    }),
  });
};

const evaluationError = () =>
  new PostHogFeatureFlagEvaluationError({
    message: "Could not evaluate the PostHog feature flag.",
    cause: undefined,
  });

afterAll(() => {
  Object.assign(WorkspaceFeatureFlagService, { Default: originalDefault });
});

afterEach(() => {
  logRecords.length = 0;
});

describe("isMeetingRoomPageEnabled", () => {
  test("treats an explicit false value as disabled without a warning", async () => {
    const isEnabled = mock(() => Effect.succeed(false));
    installFeatureFlagDefault(isEnabled);

    await expect(isMeetingRoomPageEnabled()).resolves.toBe(false);

    expect(isEnabled).toHaveBeenCalledWith("meeting_room_page");
    expect(logRecords).toEqual([]);
  });

  test("fails closed and logs when PostHog evaluation is unavailable", async () => {
    const isEnabled = mock(() => Effect.fail(evaluationError()));
    installFeatureFlagDefault(isEnabled);

    await expect(isMeetingRoomPageEnabled()).resolves.toBe(false);

    expect(isEnabled).toHaveBeenCalledWith("meeting_room_page");
    expect(logRecords).toContainEqual({
      level: "Warn",
      message: "Could not evaluate the PostHog feature flag.",
    });
  });
});
