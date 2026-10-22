import { describe, expect, test } from "bun:test";
import { PostHogFeatureFlagEvaluationError } from "@deskohub/posthog/feature-flags/node";
import { Effect, Layer, Logger, Option } from "effect";
import { WorkspaceFeatureFlagServiceMock } from "@/features/feature-flags/backend/workspace-feature-flag.service.mock";
import type { PostHogFeatureFlagKey } from "@/features/feature-flags/generated/contract";
import { SiteToolsFeatureFlagService } from "./site-tools-feature-flag.service";

const evaluateTwice = async (
  isEnabled: () => Effect.Effect<boolean, PostHogFeatureFlagEvaluationError>
) => {
  const keys: PostHogFeatureFlagKey[] = [];
  const warnings: string[] = [];
  const values = await Effect.runPromise(
    SiteToolsFeatureFlagService.pipe(
      Effect.flatMap((featureFlag) =>
        Effect.all([featureFlag.isEnabled, featureFlag.isEnabled])
      ),
      Effect.provide(
        SiteToolsFeatureFlagService.Default.pipe(
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
      ),
      Effect.provide(
        Logger.layer([
          Logger.make((options) => {
            if (options.logLevel === "Warn") {
              warnings.push(String(options.message[0]));
            }
          }),
        ])
      )
    )
  );
  return { keys, values, warnings };
};

// The PostHog adapter reports a flag missing from the evaluation, such as an
// inactive one, as an evaluation error without a cause.
const unavailable = (message: string) =>
  Effect.fail(
    new PostHogFeatureFlagEvaluationError({ message, cause: undefined })
  );

describe("SiteToolsFeatureFlagService", () => {
  test("enables site tools only for a true webmcp_site_tools flag, evaluated once", async () => {
    expect(await evaluateTwice(() => Effect.succeed(true))).toEqual({
      keys: ["webmcp_site_tools"],
      values: [true, true],
      warnings: [],
    });
  });

  test("treats an explicit false as the ordinary off state, without a warning", async () => {
    expect(await evaluateTwice(() => Effect.succeed(false))).toEqual({
      keys: ["webmcp_site_tools"],
      values: [false, false],
      warnings: [],
    });
  });

  test("fails closed and logs the flag as unavailable when PostHog omits it", async () => {
    expect(
      await evaluateTwice(() => unavailable("synthetic omitted flag"))
    ).toEqual({
      keys: ["webmcp_site_tools"],
      values: [false, false],
      warnings: ["Site tools feature flag evaluation unavailable"],
    });
  });

  test("fails closed when evaluation errors, and keeps that decision", async () => {
    let calls = 0;
    expect(
      await evaluateTwice(() =>
        calls++ === 0
          ? unavailable("synthetic flag outage")
          : Effect.succeed(true)
      )
    ).toEqual({
      keys: ["webmcp_site_tools"],
      values: [false, false],
      warnings: ["Site tools feature flag evaluation unavailable"],
    });
  });

  test("releases site tools for every visitor only while the flag is the same for everyone", async () => {
    const releaseFor = (constantValue: Option.Option<boolean>) =>
      Effect.runPromise(
        SiteToolsFeatureFlagService.pipe(
          Effect.flatMap((featureFlag) => featureFlag.release),
          Effect.provide(
            SiteToolsFeatureFlagService.Default.pipe(
              Layer.provide(
                WorkspaceFeatureFlagServiceMock({
                  constantValue: (key) =>
                    key === "webmcp_site_tools"
                      ? Effect.succeed(constantValue)
                      : Effect.die(`unexpected flag ${key}`),
                })
              )
            )
          )
        )
      );

    expect(await releaseFor(Option.some(true))).toBe("on");
    expect(await releaseFor(Option.some(false))).toBe("off");
    expect(await releaseFor(Option.none())).toBe("undecided");
  });
});
