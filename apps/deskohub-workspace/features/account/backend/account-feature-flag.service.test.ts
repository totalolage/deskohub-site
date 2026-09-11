import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import {
  PostHogFeatureFlagEvaluationError,
  type TypedPostHogFeatureFlagEvaluationSnapshot,
} from "@deskohub/posthog/feature-flags/node";
import { type Context, Effect, Logger, References } from "effect";
import { WorkspaceFeatureFlagServiceMock } from "@/features/feature-flags/backend/workspace-feature-flag.service.mock";
import type {
  PostHogFeatureFlagDefinitions,
  PostHogFeatureFlagKey,
} from "@/features/feature-flags/generated/contract";
import { AccountFeatureFlagService } from "./account-feature-flag.service";

type LogRecord = {
  readonly level: string;
  readonly message: string;
  readonly annotations: Context.Service.Shape<
    typeof References.CurrentLogAnnotations
  >;
};

const makeSnapshot = (value: boolean | undefined) =>
  ({
    getFlag: (key) => (key === "accounts" ? value : undefined),
    getFlagPayload: () => undefined,
    isEnabled: (key) => key === "accounts" && value === true,
    raw: {
      getFlag: (key) => (key === "accounts" ? value : undefined),
      getFlagPayload: () => undefined,
      isEnabled: (key) => key === "accounts" && value === true,
    },
  }) satisfies TypedPostHogFeatureFlagEvaluationSnapshot<PostHogFeatureFlagDefinitions>;

const readAccountFlag = (
  evaluateFlags: (options?: {
    readonly flagKeys?: readonly PostHogFeatureFlagKey[];
  }) => Effect.Effect<
    TypedPostHogFeatureFlagEvaluationSnapshot<PostHogFeatureFlagDefinitions>,
    PostHogFeatureFlagEvaluationError
  >
) =>
  Effect.gen(function* () {
    const featureFlag = yield* AccountFeatureFlagService;
    return yield* featureFlag.isEnabled;
  }).pipe(
    Effect.provide(AccountFeatureFlagService.Default),
    Effect.provide(WorkspaceFeatureFlagServiceMock({ evaluateFlags }))
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
    const evaluateFlags = mock(() => Effect.succeed(makeSnapshot(true)));

    const enabled = await readAccountFlag(evaluateFlags).pipe(
      Effect.runPromise
    );

    expect(enabled).toBe(true);
    expect(evaluateFlags).toHaveBeenCalledWith({ flagKeys: ["accounts"] });
  });

  test("treats an explicit false value as disabled without a warning", async () => {
    const evaluateFlags = mock(() => Effect.succeed(makeSnapshot(false)));
    const logRecords: LogRecord[] = [];

    const enabled = await readAccountFlag(evaluateFlags).pipe(
      Effect.provide(Logger.layer([captureLogger(logRecords)])),
      Effect.runPromise
    );

    expect(enabled).toBe(false);
    expect(evaluateFlags).toHaveBeenCalledWith({ flagKeys: ["accounts"] });
    expect(logRecords).toEqual([]);
  });

  test("fails closed and logs when the accounts flag is missing", async () => {
    const evaluateFlags = mock(() => Effect.succeed(makeSnapshot(undefined)));
    const logRecords: LogRecord[] = [];

    const enabled = await readAccountFlag(evaluateFlags).pipe(
      Effect.provide(Logger.layer([captureLogger(logRecords)])),
      Effect.runPromise
    );

    expect(enabled).toBe(false);
    expect(evaluateFlags).toHaveBeenCalledWith({ flagKeys: ["accounts"] });
    expect(logRecords).toContainEqual({
      level: "Warn",
      message: "Account feature flag evaluation unavailable",
      annotations: expect.anything(),
    });
    expect(JSON.stringify(logRecords)).not.toContain(
      "AccountFeatureFlagMissingError"
    );
  });

  test("fails closed and logs a fixed warning when provider evaluation fails", async () => {
    const evaluateFlags = mock(() =>
      Effect.fail(
        new PostHogFeatureFlagEvaluationError({
          message: "Account feature flag evaluation failed.",
          cause: new Error("private provider detail"),
        })
      )
    );
    const logRecords: LogRecord[] = [];

    const enabled = await readAccountFlag(evaluateFlags).pipe(
      Effect.provide(Logger.layer([captureLogger(logRecords)])),
      Effect.runPromise
    );

    expect(enabled).toBe(false);
    expect(evaluateFlags).toHaveBeenCalledWith({ flagKeys: ["accounts"] });
    expect(logRecords).toContainEqual({
      level: "Warn",
      message: "Account feature flag evaluation unavailable",
      annotations: expect.anything(),
    });
    expect(JSON.stringify(logRecords)).not.toContain("private provider detail");
  });
});
