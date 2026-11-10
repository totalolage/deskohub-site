import "server-only";

import { cached } from "@deskohub/next-effect/cached";
import { Effect, Layer, Result } from "effect";
import { cache } from "react";
import {
  runWorkspaceEffect,
  runWorkspaceEffectOrElse,
} from "@/shared/backend/workspace-effect";
import type { ReleaseGateClass } from "./release-gate";

export type ReleaseGateRequestOptions =
  | {
      /** Stable, low-cardinality run name, such as `referrals.enabled`. */
      readonly operation: string;
      /**
       * A run that fails beyond the gate's own fail-closed policy, such as a
       * defect or a runtime that cannot start, closes the gate and logs
       * `failureCode`.
       */
      readonly whenRunFails: "close";
      readonly failureCode: string;
    }
  | {
      readonly operation: string;
      /** Such a run failure rejects, as `runWorkspaceEffect` does. */
      readonly whenRunFails: "reject";
    };

export interface ReleaseGateRequest<Self> {
  /**
   * The gate's fail-closed answer, memoized per server render, for content
   * rendered after `connection()`, which is never stored. React `cache`
   * doesn't memoize in a Server Action or route handler, where every call
   * decides again, but from the flags `WorkspaceFeatureFlagService`
   * evaluated once for the request.
   */
  readonly isOpen: () => Promise<boolean>;
  /**
   * The gate's answer for output that can be stored, such as a static shell
   * or metadata, memoized per server render, so layouts, metadata, pages,
   * and loaders of one render share it. It rejects with
   * `ReleaseGateUnavailableError` while PostHog can't decide the flag, so a
   * regeneration fails and keeps the last good copy.
   */
  readonly decision: () => Promise<boolean>;
  /**
   * The same answers for Effect consumers, so services and the page or
   * action that gated them agree. Each is read only when a consumer asks,
   * then at most once per build of the layer.
   */
  readonly layer: Layer.Layer<Self>;
}

/** A release gate's decisions for one request. */
export const releaseGateForRequest = <Self>(
  gate: ReleaseGateClass<Self>,
  options: ReleaseGateRequestOptions
): ReleaseGateRequest<Self> => {
  // Each read is memoized as its result, so a decision PostHog couldn't make
  // is kept for the render as the failure it is, while a run failure beyond
  // the gate's policy meets `whenRunFails`.
  const decide = <E>(read: Effect.Effect<boolean, E, Self>) =>
    cache(
      (): Promise<Result.Result<boolean, E>> =>
        read.pipe(
          Effect.result,
          Effect.provide(gate.Live),
          options.whenRunFails === "close"
            ? runWorkspaceEffectOrElse(options.operation, {
                failureCode: options.failureCode,
                orElse: () => Result.succeed(false),
              })
            : runWorkspaceEffect(options.operation)
        )
    );
  const isOpenResult = decide(gate.isOpen);
  const decisionResult = decide(gate.decision);
  const answer = <E>(result: Result.Result<boolean, E>) =>
    Result.match(result, {
      onSuccess: (open) => open,
      onFailure: (error) => Promise.reject(error),
    });
  const isOpen = () => isOpenResult().then(answer);
  const decision = () => decisionResult().then(answer);
  return {
    isOpen,
    decision,
    layer: Layer.unwrap(
      // React `cache` keys on the arguments, so call each read exactly as
      // pages do; `Effect.promise` would pass it one.
      Effect.all({
        isOpen: cached(Effect.promise(() => isOpen())),
        decision: cached(
          Effect.promise(() => decisionResult()).pipe(
            Effect.flatMap(Effect.fromResult)
          )
        ),
      }).pipe(
        Effect.map(({ isOpen, decision }) =>
          gate.fromEvaluation(isOpen, decision)
        )
      )
    ),
  };
};
