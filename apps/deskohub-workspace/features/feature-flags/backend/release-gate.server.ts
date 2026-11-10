import "server-only";

import { cached } from "@deskohub/next-effect/cached";
import { Effect, Layer, Result } from "effect";
import { connection } from "next/server";
import { cache } from "react";
import {
  runWorkspaceEffect,
  runWorkspaceEffectOrElse,
} from "@/shared/backend/workspace-effect";
import { getWorkspaceFeatureFlagConstancy } from "./feature-flag-evaluation-mode.server";
import { loadGlobalRelease } from "./global-release.server";
import type {
  ReleaseGateClass,
  ReleaseGateUnavailableError,
} from "./release-gate";

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
   *
   * A flag that is the same for every visitor is decided without the
   * request. A flag PostHog decides per visitor is evaluated only at request
   * time, after `connection()`.
   */
  readonly isOpen: () => Promise<boolean>;
  /**
   * The gate's answer for output that can be stored, such as a static shell
   * or metadata, memoized per server render, so layouts, metadata, pages,
   * and loaders of one render share it. It rejects with
   * `ReleaseGateUnavailableError` while PostHog can't decide the flag, so a
   * regeneration fails and keeps the last good copy.
   *
   * A flag that is the same for every visitor is decided without the
   * request, so prerendered shells keep the decision. A flag PostHog decides
   * per visitor is evaluated only at request time, after `connection()`.
   * Without any classification of the flags, it rejects at once, without
   * the request.
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
  const answer = <E>(result: Result.Result<boolean, E>) =>
    Result.match(result, {
      onSuccess: (open) => open,
      onFailure: (error) => Promise.reject(error),
    });
  const isOpenForVisitor = decide(gate.isOpen);
  const decisionForVisitor = decide(gate.decision);
  // A flag that is the same for every visitor answers without the request.
  // PostHog decides any other flag per visitor, over the network: request
  // work. A prerender, a runtime prefetch included, stops at `connection()`
  // instead of asking PostHog, whose client reads the clock while
  // prerendering.
  const isOpen = cache(async (): Promise<boolean> => {
    const release = await loadGlobalRelease(gate.flag);
    if (release !== "undecided") return release === "on";
    await connection();
    return isOpenForVisitor().then(answer);
  });
  const decisionResult = cache(
    async (): Promise<Result.Result<boolean, ReleaseGateUnavailableError>> => {
      const release = await loadGlobalRelease(gate.flag);
      if (release !== "undecided") return Result.succeed(release === "on");
      // Without a classification nothing tells a per-visitor flag from a
      // constant one, and the stored read fails without the request. It
      // fails before `connection()`, so a regeneration fails and keeps the
      // last good copy instead of postponing the read.
      const constancy = await getWorkspaceFeatureFlagConstancy(gate.flag);
      if (constancy.kind !== "unclassified") await connection();
      return decisionForVisitor();
    }
  );
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
