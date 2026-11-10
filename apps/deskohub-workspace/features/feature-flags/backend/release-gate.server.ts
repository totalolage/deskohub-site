import "server-only";

import { cached } from "@deskohub/next-effect/cached";
import { Effect, Layer } from "effect";
import { connection } from "next/server";
import { cache } from "react";
import {
  runWorkspaceEffect,
  runWorkspaceEffectOrElse,
} from "@/shared/backend/workspace-effect";
import { loadGlobalRelease } from "./global-release.server";
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
   * The gate's decision, memoized per server render, so layouts, metadata,
   * pages, and loaders of one render share it. React `cache` doesn't memoize
   * in a Server Action or route handler, where every call decides again, but
   * from the flags `WorkspaceFeatureFlagService` evaluated once for the
   * request.
   *
   * A flag that is the same for every visitor is decided without the
   * request, so prerendered shells keep the decision. A flag PostHog decides
   * per visitor is evaluated only at request time, after `connection()`.
   */
  readonly isOpen: () => Promise<boolean>;
  /**
   * The same decision for Effect consumers, so services and the page or
   * action that gated them agree. It reads the decision only when a
   * consumer asks, then at most once per build of the layer.
   */
  readonly layer: Layer.Layer<Self>;
}

/** A release gate's one decision per request. */
export const releaseGateForRequest = <Self>(
  gate: ReleaseGateClass<Self>,
  options: ReleaseGateRequestOptions
): ReleaseGateRequest<Self> => {
  const decideForVisitor = (): Promise<boolean> => {
    const decision = gate.isOpen.pipe(Effect.provide(gate.Live));
    return options.whenRunFails === "close"
      ? decision.pipe(
          runWorkspaceEffectOrElse(options.operation, {
            failureCode: options.failureCode,
            orElse: () => false,
          })
        )
      : decision.pipe(runWorkspaceEffect(options.operation));
  };
  const isOpen = cache(async (): Promise<boolean> => {
    switch (await loadGlobalRelease(gate.flag)) {
      case "on":
        return true;
      case "off":
        return false;
      case "undecided":
        // PostHog decides the flag per visitor, over the network: request
        // work. A prerender, a runtime prefetch included, stops here instead
        // of asking PostHog, whose client reads the clock while prerendering.
        await connection();
        return decideForVisitor();
    }
  });
  return {
    isOpen,
    layer: Layer.unwrap(
      // React `cache` keys on the arguments, so call `isOpen` exactly as
      // pages do; `Effect.promise` would pass it one.
      cached(Effect.promise(() => isOpen())).pipe(
        Effect.map(gate.fromEvaluation)
      )
    ),
  };
};
