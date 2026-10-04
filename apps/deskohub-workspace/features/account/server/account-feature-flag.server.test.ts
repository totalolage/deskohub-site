import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import { Effect, Logger } from "effect";
import {
  AccountAvatarFeatureFlagUnavailableError,
  type IAccountFeatureFlagService,
} from "../backend/account-feature-flag.service";
import { AccountFeatureFlagServiceMock } from "../backend/account-feature-flag.service.mock";

mock.module("@/shared/backend/workspace-effect", () => ({
  runWorkspaceEffect:
    (_operation: string) =>
    <A, E>(effect: Effect.Effect<A, E, never>): Promise<A> =>
      Effect.runPromise(effect),
}));

const { accountAvatarsEnabled } = await import("./account-feature-flag.server");

const provideAvatarFlag = (
  isAvatarEnabled: IAccountFeatureFlagService["isAvatarEnabled"]
) =>
  Effect.provide(
    AccountFeatureFlagServiceMock({
      isEnabled: Effect.succeed(false),
      isAvatarEnabled,
    })
  );

describe("account avatar feature flag boundary", () => {
  test("returns true when the account avatar capability is enabled", async () => {
    const enabled = await accountAvatarsEnabled.pipe(
      provideAvatarFlag(Effect.succeed(true)),
      Effect.runPromise
    );

    expect(enabled).toBe(true);
  });

  test("returns false without warning when the capability is explicitly disabled", async () => {
    const logRecords: string[] = [];
    const logger = Logger.make((options) => {
      logRecords.push(options.message.join(""));
    });

    const enabled = await accountAvatarsEnabled.pipe(
      provideAvatarFlag(Effect.succeed(false)),
      Effect.provide(Logger.layer([logger])),
      Effect.runPromise
    );

    expect(enabled).toBe(false);
    expect(logRecords).toEqual([]);
  });

  test("fails closed with a fixed warning when the capability is unavailable", async () => {
    const logRecords: string[] = [];
    const logger = Logger.make((options) => {
      logRecords.push(options.message.join(""));
    });

    const enabled = await accountAvatarsEnabled.pipe(
      provideAvatarFlag(
        Effect.fail(
          new AccountAvatarFeatureFlagUnavailableError({
            message: "Account avatar feature flag evaluation unavailable",
          })
        )
      ),
      Effect.provide(Logger.layer([logger])),
      Effect.runPromise
    );

    expect(enabled).toBe(false);
    expect(logRecords).toContain(
      "Account avatar feature flag evaluation unavailable"
    );
  });
});
