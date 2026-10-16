import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import { PostHogFeatureFlagEvaluationError } from "@deskohub/posthog/feature-flags/node";
import { type Context, Effect, Logger, References } from "effect";
import { WorkspaceFeatureFlagServiceMock } from "@/features/feature-flags/backend/workspace-feature-flag.service.mock";
import type { PostHogFeatureFlagKey } from "@/features/feature-flags/generated/contract";
import { AccountFeatureFlagService } from "./account-feature-flag.service";

type LogRecord = {
  readonly level: string;
  readonly message: string;
  readonly annotations: Context.Service.Shape<
    typeof References.CurrentLogAnnotations
  >;
};

const captureLogger = (records: LogRecord[]) =>
  Logger.make((options) => {
    records.push({
      annotations: options.fiber.getRef(References.CurrentLogAnnotations),
      level: options.logLevel,
      message: options.message.join(""),
    });
  });

describe("AccountFeatureFlagService", () => {
  const readSignInCodeFlag = (
    isEnabled: (
      key: PostHogFeatureFlagKey
    ) => Effect.Effect<boolean, PostHogFeatureFlagEvaluationError>
  ) =>
    Effect.flatMap(
      AccountFeatureFlagService,
      (featureFlag) => featureFlag.isSignInCodeEnabled
    ).pipe(
      Effect.provide(AccountFeatureFlagService.Default),
      Effect.provide(WorkspaceFeatureFlagServiceMock({ isEnabled }))
    );

  test("reads login_email_code and enables sign-in codes only for true", async () => {
    const isEnabled = mock(() => Effect.succeed(true));

    expect(await Effect.runPromise(readSignInCodeFlag(isEnabled))).toBe(true);
    expect(isEnabled).toHaveBeenCalledWith("login_email_code");
    expect(
      await Effect.runPromise(readSignInCodeFlag(() => Effect.succeed(false)))
    ).toBe(false);
  });

  test("fails sign-in codes closed with a fixed warning when evaluation fails", async () => {
    const logRecords: LogRecord[] = [];

    const enabled = await readSignInCodeFlag(() =>
      Effect.fail(
        new PostHogFeatureFlagEvaluationError({
          message: "Sign-in code flag evaluation failed.",
          cause: new Error("private provider detail"),
        })
      )
    ).pipe(
      Effect.provide(Logger.layer([captureLogger(logRecords)])),
      Effect.runPromise
    );

    expect(enabled).toBe(false);
    expect(logRecords).toContainEqual({
      level: "Warn",
      message: "Sign-in code feature flag evaluation unavailable",
      annotations: expect.anything(),
    });
    expect(JSON.stringify(logRecords)).not.toContain("private provider detail");
  });

  const readPasskeyFlag = (
    isEnabled: (
      key: PostHogFeatureFlagKey
    ) => Effect.Effect<boolean, PostHogFeatureFlagEvaluationError>
  ) =>
    Effect.flatMap(
      AccountFeatureFlagService,
      (featureFlag) => featureFlag.isPasskeyEnabled
    ).pipe(
      Effect.provide(AccountFeatureFlagService.Default),
      Effect.provide(WorkspaceFeatureFlagServiceMock({ isEnabled }))
    );

  test("reads login_passkeys and enables passkeys only for true", async () => {
    const isEnabled = mock(() => Effect.succeed(true));

    expect(await Effect.runPromise(readPasskeyFlag(isEnabled))).toBe(true);
    expect(isEnabled).toHaveBeenCalledWith("login_passkeys");
    expect(
      await Effect.runPromise(readPasskeyFlag(() => Effect.succeed(false)))
    ).toBe(false);
  });

  test("fails passkeys closed with a fixed warning when evaluation fails", async () => {
    const logRecords: LogRecord[] = [];

    const enabled = await readPasskeyFlag(() =>
      Effect.fail(
        new PostHogFeatureFlagEvaluationError({
          message: "Passkey flag evaluation failed.",
          cause: new Error("private provider detail"),
        })
      )
    ).pipe(
      Effect.provide(Logger.layer([captureLogger(logRecords)])),
      Effect.runPromise
    );

    expect(enabled).toBe(false);
    expect(logRecords).toContainEqual({
      level: "Warn",
      message: "Passkey feature flag evaluation unavailable",
      annotations: expect.anything(),
    });
    expect(JSON.stringify(logRecords)).not.toContain("private provider detail");
  });
});
