import { describe, expect, test } from "bun:test";
import { PostHogFeatureFlagEvaluationError } from "@deskohub/posthog/feature-flags/node";
import {
  type Context,
  Effect,
  Layer,
  Logger,
  Option,
  References,
} from "effect";
import { countWallClockReads } from "@/shared/testing/workspace-test-clock.test-utils";
import type { PostHogFeatureFlagKey } from "../generated/contract";
import { closeUnavailableRelease, releaseFromValue } from "./release-gate";
import { TestReleaseGate } from "./release-gate.test-utils";
import { WorkspaceFeatureFlagServiceMock } from "./workspace-feature-flag.service.mock";

type LogRecord = {
  readonly level: string;
  readonly message: unknown;
  readonly annotations: Context.Service.Shape<
    typeof References.CurrentLogAnnotations
  >;
};

const recordLogs = <A, E>(effect: Effect.Effect<A, E>) => {
  const logs: LogRecord[] = [];
  return Effect.runPromise(
    effect.pipe(
      Effect.provide(
        Logger.layer([
          Logger.make((options) => {
            logs.push({
              level: options.logLevel,
              message: options.message[0],
              annotations: options.fiber.getRef(
                References.CurrentLogAnnotations
              ),
            });
          }),
        ])
      )
    )
  ).then((value) => ({ value, logs }));
};

const decideTwice = async (
  isEnabled: () => Effect.Effect<boolean, PostHogFeatureFlagEvaluationError>
) => {
  const keys: PostHogFeatureFlagKey[] = [];
  const { value, logs } = await recordLogs(
    Effect.all([TestReleaseGate.isOpen, TestReleaseGate.isOpen]).pipe(
      Effect.provide(
        TestReleaseGate.Default.pipe(
          Layer.provide(
            WorkspaceFeatureFlagServiceMock({
              isEnabled: (key) =>
                Effect.suspend(() => {
                  keys.push(key);
                  return isEnabled();
                }),
            })
          )
        )
      )
    )
  );
  return { keys, values: value, logs };
};

// The PostHog adapter reports a flag missing from the evaluation, such as an
// inactive one, as an evaluation error without a cause.
const unavailable = (cause?: unknown) =>
  Effect.fail(
    new PostHogFeatureFlagEvaluationError({
      message: "Could not evaluate the PostHog feature flag.",
      cause,
    })
  );

const unavailableLog = (
  flags: ReadonlyArray<PostHogFeatureFlagKey>,
  reason: "omitted" | "evaluation_failed"
) => ({
  level: "Warn",
  message: "Release gate unavailable; it stays closed",
  annotations: { releaseGateFlags: flags, releaseGateReason: reason },
});

describe("ReleaseGate", () => {
  test("opens only for a true flag, evaluated once per build", async () => {
    expect(await decideTwice(() => Effect.succeed(true))).toEqual({
      keys: ["webmcp_site_tools"],
      values: [true, true],
      logs: [],
    });
  });

  test("treats an explicit false as the ordinary closed state, without a log", async () => {
    expect(await decideTwice(() => Effect.succeed(false))).toEqual({
      keys: ["webmcp_site_tools"],
      values: [false, false],
      logs: [],
    });
  });

  test("stays closed and logs the flag once, without its cause, when evaluation fails", async () => {
    const decision = await decideTwice(() =>
      unavailable(new Error("private provider detail"))
    );

    expect(decision).toEqual({
      keys: ["webmcp_site_tools"],
      values: [false, false],
      logs: [unavailableLog(["webmcp_site_tools"], "evaluation_failed")],
    });
    expect(JSON.stringify(decision.logs)).not.toContain(
      "private provider detail"
    );
  });

  test("stays closed and logs the flag once when PostHog omits it", async () => {
    expect(await decideTwice(() => unavailable())).toEqual({
      keys: ["webmcp_site_tools"],
      values: [false, false],
      logs: [unavailableLog(["webmcp_site_tools"], "evaluation_failed")],
    });
  });

  test("keeps a decision made, so a later outage cannot change it", async () => {
    let calls = 0;
    expect(
      await decideTwice(() =>
        calls++ === 0 ? Effect.succeed(true) : unavailable()
      )
    ).toEqual({
      keys: ["webmcp_site_tools"],
      values: [true, true],
      logs: [],
    });
  });

  test("decides without reading the wall clock, so Next.js can prerender it", async () => {
    const { value, wallClockReads } = await Effect.runPromise(
      countWallClockReads(
        Effect.all([TestReleaseGate.isOpen, TestReleaseGate.isOpen]).pipe(
          Effect.provide(
            TestReleaseGate.Default.pipe(
              Layer.provide(
                WorkspaceFeatureFlagServiceMock({
                  isEnabled: () => Effect.succeed(true),
                })
              )
            )
          )
        )
      )
    );

    expect({ value, wallClockReads }).toEqual({
      value: [true, true],
      wallClockReads: 0,
    });
  });

  test("answers a decision the caller made, without evaluating", async () => {
    for (const open of [true, false]) {
      expect(
        await Effect.runPromise(
          TestReleaseGate.isOpen.pipe(
            Effect.provide(TestReleaseGate.fromDecision(open))
          )
        )
      ).toBe(open);
    }
  });

  test("describes the release for every visitor only while the flag is the same for everyone", async () => {
    const releaseFor = (constantValue: Option.Option<boolean>) =>
      Effect.runPromise(
        TestReleaseGate.release.pipe(
          Effect.provide(
            WorkspaceFeatureFlagServiceMock({
              constantValue: (key) =>
                key === "webmcp_site_tools"
                  ? Effect.succeed(constantValue)
                  : Effect.die(`unexpected flag ${key}`),
            })
          )
        )
      );

    expect(await releaseFor(Option.some(true))).toBe("on");
    expect(await releaseFor(Option.some(false))).toBe("off");
    expect(await releaseFor(Option.none())).toBe("undecided");
  });
});

describe("releaseFromValue", () => {
  test("opens only for true and logs an omitted flag as unavailable", async () => {
    expect(await recordLogs(releaseFromValue("discount_codes", true))).toEqual({
      value: true,
      logs: [],
    });
    expect(await recordLogs(releaseFromValue("discount_codes", false))).toEqual(
      { value: false, logs: [] }
    );
    expect(
      await recordLogs(releaseFromValue("discount_codes", undefined))
    ).toEqual({
      value: false,
      logs: [unavailableLog(["discount_codes"], "omitted")],
    });
  });
});

describe("closeUnavailableRelease", () => {
  test("answers the closed value and logs every flag once when evaluation fails", async () => {
    const flags = ["calendar_sales", "discount_codes"] as const;
    expect(
      await recordLogs(
        unavailable(new Error("private provider detail")).pipe(
          closeUnavailableRelease(flags, "closed")
        )
      )
    ).toEqual({
      value: "closed",
      logs: [unavailableLog(flags, "evaluation_failed")],
    });
  });
});
