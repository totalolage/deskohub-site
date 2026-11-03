import { cached } from "@deskohub/next-effect/cached";
import { Context, Effect, Layer } from "effect";
import type { PostHogFeatureFlagKey } from "../generated/contract";
import { type GlobalRelease, globalRelease } from "./global-release";
import { WorkspaceFeatureFlagService } from "./workspace-feature-flag.service";

export interface IReleaseGate {
  /**
   * Whether the gate is open. Only `true` opens it. A flag PostHog omits or
   * can't evaluate keeps it closed and is logged once as unavailable.
   */
  readonly isOpen: Effect.Effect<boolean>;
}

/**
 * A feature's release gate over one boolean flag, as a Context capability:
 *
 * ```ts
 * export class OfficeReleaseGate extends ReleaseGate<OfficeReleaseGate>()(
 *   "@deskohub-workspace/office/OfficeReleaseGate",
 *   "office_page"
 * ) {}
 * ```
 *
 * `Default` decides the gate at most once per build of the layer, so one run
 * sees one decision; never put it in a process-wide runtime layer. Request
 * code that must agree with its page provides the request's memoized
 * decision instead (`releaseGateForRequest` in `release-gate.server.ts`).
 */
export const ReleaseGate =
  <Self>() =>
  <const Identifier extends string>(
    identifier: Identifier,
    flag: PostHogFeatureFlagKey
  ) =>
    class Gate extends Context.Service<Self, IReleaseGate>()(identifier) {
      /** The provided gate's decision. */
      static readonly isOpen: Effect.Effect<boolean, never, Self> =
        Effect.flatMap(this, (gate) => gate.isOpen);

      static readonly Default = Layer.effect(
        this,
        WorkspaceFeatureFlagService.pipe(
          Effect.flatMap((featureFlags) =>
            cached(
              featureFlags
                .isEnabled(flag)
                .pipe(closeUnavailableRelease([flag], false))
            )
          ),
          Effect.map((isOpen): IReleaseGate => ({ isOpen }))
        )
      );

      static readonly Live = this.Default.pipe(
        Layer.provide(WorkspaceFeatureFlagService.Default)
      );

      /** A decision the caller already made, such as for a cached render. */
      static readonly fromDecision = (open: boolean) =>
        Layer.succeed(this, { isOpen: Effect.succeed(open) });

      /**
       * A gate that answers with `isOpen`, such as the request's memoized
       * decision. `isOpen` keeps the gate's fail-closed policy itself.
       */
      static readonly fromEvaluation = (isOpen: Effect.Effect<boolean>) =>
        Layer.succeed(this, { isOpen });

      /**
       * Whether the gate is open for every visitor, read without the request,
       * so static output can describe it.
       */
      static readonly release: Effect.Effect<
        GlobalRelease,
        never,
        WorkspaceFeatureFlagService
      > = WorkspaceFeatureFlagService.pipe(
        Effect.flatMap((featureFlags) => featureFlags.constantValue(flag)),
        Effect.map(globalRelease)
      );
    };

/** The class `ReleaseGate` declares for a feature's gate. */
export interface ReleaseGateClass<Self> {
  readonly isOpen: Effect.Effect<boolean, never, Self>;
  readonly Live: Layer.Layer<Self>;
  readonly fromDecision: (open: boolean) => Layer.Layer<Self>;
  readonly fromEvaluation: (
    isOpen: Effect.Effect<boolean>
  ) => Layer.Layer<Self>;
}

/**
 * The gate for one value PostHog returned: only `true` opens it. An omitted
 * value means PostHog didn't evaluate the flag, for example because it's
 * inactive; it closes the gate and is logged as unavailable.
 */
export const releaseFromValue = (
  flag: PostHogFeatureFlagKey,
  value: boolean | undefined
): Effect.Effect<boolean> =>
  value === undefined
    ? logUnavailableRelease([flag], "omitted").pipe(Effect.as(false))
    : Effect.succeed(value === true);

/**
 * Answers `closed` when the flags' evaluation fails, logging the failure
 * once with the flag keys. The provider cause stays out of the log. A
 * single-flag lookup reports a flag PostHog omitted as such a failure.
 */
export const closeUnavailableRelease =
  <B>(flags: ReadonlyArray<PostHogFeatureFlagKey>, closed: B) =>
  <A, E, R>(
    evaluation: Effect.Effect<A, E, R>
  ): Effect.Effect<A | B, never, R> =>
    evaluation.pipe(
      Effect.tapError(() => logUnavailableRelease(flags, "evaluation_failed")),
      Effect.orElseSucceed(() => closed)
    );

const logUnavailableRelease = (
  flags: ReadonlyArray<PostHogFeatureFlagKey>,
  reason: "omitted" | "evaluation_failed"
) =>
  Effect.logWarning("Release gate unavailable; it stays closed").pipe(
    Effect.annotateLogs({
      releaseGateFlags: flags,
      releaseGateReason: reason,
    })
  );
