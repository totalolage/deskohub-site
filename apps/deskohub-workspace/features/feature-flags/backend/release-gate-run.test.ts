import { describe, expect, test } from "bun:test";
import { PostHogFeatureFlagEvaluationError } from "@deskohub/posthog/feature-flags/node";
import { type Context, Effect, Exit, Logger, References } from "effect";
import {
  TestReleaseGate,
  testReleaseGateEvaluating,
} from "./release-gate.test-utils";
import {
  type ReleaseGateRunPolicy,
  releaseGateForRun,
} from "./release-gate-run";

type LogRecord = {
  readonly level: string;
  /** What the log carries beside its message, where a cause would leak. */
  readonly details: readonly unknown[];
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
              details: options.message.slice(1),
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

const unavailable = (cause?: unknown) =>
  Effect.fail(
    new PostHogFeatureFlagEvaluationError({
      message: "Could not evaluate the PostHog feature flag.",
      cause,
    })
  );

const unavailableLog = {
  level: "Warn",
  details: [],
  annotations: {
    releaseGateFlags: ["webmcp_site_tools"],
    releaseGateReason: "evaluation_failed",
  },
};
describe("releaseGateForRun", () => {
  const closing: ReleaseGateRunPolicy = {
    whenRunFails: "close",
    failureCode: "test_feature_flag_unavailable",
  };
  const rejecting: ReleaseGateRunPolicy = { whenRunFails: "reject" };

  /**
   * Reads the gate twice per build over `builds` builds of one layer, as
   * consumers of separate requests would, counting flag evaluations.
   */
  const decide = async (
    policy: ReleaseGateRunPolicy,
    isEnabled: () => Effect.Effect<boolean, PostHogFeatureFlagEvaluationError>,
    options: { readonly builds?: number; readonly reads?: number } = {}
  ) => {
    let evaluations = 0;
    const layer = releaseGateForRun(
      testReleaseGateEvaluating(() =>
        Effect.suspend(() => {
          evaluations += 1;
          return isEnabled();
        })
      ),
      policy
    );
    const reads = Effect.all(
      Array.from({ length: options.reads ?? 2 }, () => TestReleaseGate.isOpen)
    ).pipe(Effect.provide(layer));
    const { value, logs } = await recordLogs(
      Effect.all(
        Array.from({ length: options.builds ?? 1 }, () => Effect.exit(reads))
      )
    );
    return { exits: value, evaluations, logs };
  };

  for (const policy of [closing, rejecting]) {
    describe(`when a run failure should ${policy.whenRunFails}`, () => {
      test("opens only for a true flag, evaluated once per build", async () => {
        expect(await decide(policy, () => Effect.succeed(true))).toEqual({
          exits: [Exit.succeed([true, true])],
          evaluations: 1,
          logs: [],
        });
      });

      test("stays closed for an explicit false", async () => {
        expect(await decide(policy, () => Effect.succeed(false))).toEqual({
          exits: [Exit.succeed([false, false])],
          evaluations: 1,
          logs: [],
        });
      });

      test("stays closed and logs the flag once when evaluation fails", async () => {
        expect(
          await decide(policy, () =>
            unavailable(new Error("private provider detail"))
          )
        ).toEqual({
          exits: [Exit.succeed([false, false])],
          evaluations: 1,
          logs: [unavailableLog],
        });
      });

      test("decides again on every build, so each request gets its own decision", async () => {
        let calls = 0;
        const { exits, evaluations } = await decide(
          policy,
          () => Effect.succeed(calls++ === 0),
          { builds: 2 }
        );
        expect(exits).toEqual([
          Exit.succeed([true, true]),
          Exit.succeed([false, false]),
        ]);
        expect(evaluations).toBe(2);
      });

      test("evaluates nothing until a consumer asks", async () => {
        const { evaluations } = await decide(
          policy,
          () => Effect.succeed(true),
          { reads: 0 }
        );
        expect(evaluations).toBe(0);
      });
    });
  }

  test("closes the gate and logs only its failure code when the run dies", async () => {
    const decision = await decide(closing, () =>
      Effect.die(new Error("private defect detail"))
    );

    expect(decision.exits).toEqual([Exit.succeed([false, false])]);
    expect(decision.evaluations).toBe(1);
    expect(decision.logs).toEqual([
      {
        level: "Warn",
        details: [],
        annotations: { failureCode: "test_feature_flag_unavailable" },
      },
    ]);
    expect(JSON.stringify(decision.logs)).not.toContain(
      "private defect detail"
    );
  });

  test("fails the request when the run dies and the policy rejects", async () => {
    const defect = new Error("flag runtime broke");
    const { exits, logs } = await decide(rejecting, () => Effect.die(defect));

    expect(exits).toEqual([Exit.die(defect)]);
    expect(logs).toEqual([]);
  });

  test("lets interruption through even when a run failure closes", async () => {
    const { exits } = await decide(closing, () => Effect.interrupt);

    expect(exits).toHaveLength(1);
    const [exit] = exits;
    expect(exit !== undefined && Exit.hasInterrupts(exit)).toBe(true);
  });
});
