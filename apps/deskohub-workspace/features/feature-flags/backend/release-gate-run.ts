import { cached } from "@deskohub/next-effect/cached";
import { Effect, identity, Layer } from "effect";
import { catchRecoverableCause } from "@/shared/backend/workspace-effect";
import type { ReleaseGateClass } from "./release-gate";

/** What a gate's request decision does when its run fails. */
export type ReleaseGateRunPolicy =
  | {
      /**
       * A run that fails beyond the gate's own fail-closed policy, such as a
       * defect, closes the gate and logs `failureCode`.
       */
      readonly whenRunFails: "close";
      readonly failureCode: string;
    }
  | {
      /** Such a run failure fails the request. */
      readonly whenRunFails: "reject";
    };

/**
 * A gate's decision for a request served outside Next.js request scope, such
 * as an HttpApi handler: read only when a consumer asks, at most once per
 * build of the layer, with the run-failure policy `releaseGateForRequest`
 * applies at the Next.js edge, but without React `cache` or a nested runner.
 * Build it once per request. Interruption and Next.js control flow always
 * propagate. The gate's own `Live` evaluation still reads flag definitions
 * through Next.js's data cache (`"use cache"`), so the handler must run in
 * the Next.js server, as a route handler does, not a standalone process.
 */
export const releaseGateForRun = <Self>(
  gate: ReleaseGateClass<Self>,
  policy: ReleaseGateRunPolicy
): Layer.Layer<Self> =>
  Layer.unwrap(
    cached(
      gate.isOpen.pipe(
        Effect.provide(gate.Live),
        policy.whenRunFails === "close"
          ? catchRecoverableCause(() =>
              Effect.logWarning(
                "Release gate run failed; it stays closed"
              ).pipe(
                Effect.annotateLogs({ failureCode: policy.failureCode }),
                Effect.as(false)
              )
            )
          : identity
      )
    ).pipe(Effect.map(gate.fromEvaluation))
  );
