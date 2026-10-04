import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import { PostHogFeatureFlagEvaluationError } from "@deskohub/posthog/feature-flags/node";
import { type Context, Effect, Logger, References } from "effect";
import { WorkspaceFeatureFlagServiceMock } from "@/features/feature-flags/backend/workspace-feature-flag.service.mock";
import type { PostHogFeatureFlagKey } from "@/features/feature-flags/generated/contract";
import {
  AccountAvatarFeatureFlagUnavailableError,
  AccountFeatureFlagService,
} from "./account-feature-flag.service";

type LogRecord = {
  readonly level: string;
  readonly message: string;
  readonly annotations: Context.Service.Shape<
    typeof References.CurrentLogAnnotations
  >;
};

const readAccountFlag = (
  isEnabled: (
    key: PostHogFeatureFlagKey
  ) => Effect.Effect<boolean, PostHogFeatureFlagEvaluationError>
) =>
  Effect.gen(function* () {
    const featureFlag = yield* AccountFeatureFlagService;
    return yield* featureFlag.isEnabled;
  }).pipe(
    Effect.provide(AccountFeatureFlagService.Default),
    Effect.provide(WorkspaceFeatureFlagServiceMock({ isEnabled }))
  );

const captureLogger = (records: LogRecord[]) =>
  Logger.make((options) => {
    records.push({
      annotations: options.fiber.getRef(References.CurrentLogAnnotations),
      level: options.logLevel,
      message: options.message.join(""),
    });
  });

describe("AccountFeatureFlagService", () => {
  test("enables accounts when the accounts flag is true", async () => {
    const isEnabled = mock(() => Effect.succeed(true));

    const enabled = await readAccountFlag(isEnabled).pipe(Effect.runPromise);

    expect(enabled).toBe(true);
    expect(isEnabled).toHaveBeenCalledWith("accounts");
  });

  test("treats an explicit false value as disabled without a warning", async () => {
    const isEnabled = mock(() => Effect.succeed(false));
    const logRecords: LogRecord[] = [];

    const enabled = await readAccountFlag(isEnabled).pipe(
      Effect.provide(Logger.layer([captureLogger(logRecords)])),
      Effect.runPromise
    );

    expect(enabled).toBe(false);
    expect(isEnabled).toHaveBeenCalledWith("accounts");
    expect(logRecords).toEqual([]);
  });

  test("fails closed and logs when the accounts flag is missing", async () => {
    const isEnabled = mock(() =>
      Effect.fail(
        new PostHogFeatureFlagEvaluationError({
          message: "Could not evaluate the PostHog feature flag.",
          cause: undefined,
        })
      )
    );
    const logRecords: LogRecord[] = [];

    const enabled = await readAccountFlag(isEnabled).pipe(
      Effect.provide(Logger.layer([captureLogger(logRecords)])),
      Effect.runPromise
    );

    expect(enabled).toBe(false);
    expect(isEnabled).toHaveBeenCalledWith("accounts");
    expect(logRecords).toContainEqual({
      level: "Warn",
      message: "Account feature flag evaluation unavailable",
      annotations: expect.anything(),
    });
  });

  test("fails closed and logs a fixed warning when provider evaluation fails", async () => {
    const isEnabled = mock(() =>
      Effect.fail(
        new PostHogFeatureFlagEvaluationError({
          message: "Account feature flag evaluation failed.",
          cause: new Error("private provider detail"),
        })
      )
    );
    const logRecords: LogRecord[] = [];

    const enabled = await readAccountFlag(isEnabled).pipe(
      Effect.provide(Logger.layer([captureLogger(logRecords)])),
      Effect.runPromise
    );

    expect(enabled).toBe(false);
    expect(isEnabled).toHaveBeenCalledWith("accounts");
    expect(logRecords).toContainEqual({
      level: "Warn",
      message: "Account feature flag evaluation unavailable",
      annotations: expect.anything(),
    });
    expect(JSON.stringify(logRecords)).not.toContain("private provider detail");
  });

  test("keeps the avatar capability unavailable until its generated contract exists", async () => {
    let isEnabledEffectRan = false;
    const isEnabled = mock(() =>
      Effect.sync(() => {
        isEnabledEffectRan = true;
        return false;
      })
    );
    const outcome = await Effect.gen(function* () {
      const featureFlag = yield* AccountFeatureFlagService;
      return yield* featureFlag.isAvatarEnabled.pipe(Effect.result);
    }).pipe(
      Effect.provide(AccountFeatureFlagService.Default),
      Effect.provide(WorkspaceFeatureFlagServiceMock({ isEnabled })),
      Effect.runPromise
    );

    expect(outcome._tag).toBe("Failure");
    if (outcome._tag === "Failure") {
      expect(outcome.failure).toBeInstanceOf(
        AccountAvatarFeatureFlagUnavailableError
      );
      expect(outcome.failure.message).toBe(
        "Account avatar feature flag evaluation unavailable"
      );
    }
    expect(isEnabled).toHaveBeenCalledWith("accounts");
    expect(isEnabledEffectRan).toBe(false);
  });
});
