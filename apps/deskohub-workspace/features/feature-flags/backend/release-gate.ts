import { cached } from "@deskohub/next-effect/cached";
import { Context, Data, Effect, Layer } from "effect";
import type { PostHogFeatureFlagKey } from "../generated/contract";
import { type GlobalRelease, globalRelease } from "./global-release";
import { WorkspaceFeatureFlagService } from "./workspace-feature-flag.service";

/**
 * PostHog couldn't decide the gate's flags: they couldn't be classified or
 * evaluated, or PostHog left them out. Output that can be stored fails with
 * it, so a regeneration keeps the last good copy instead of a closed gate.
 */
export class ReleaseGateUnavailableError extends Data.TaggedError(
  "ReleaseGateUnavailableError"
)<{
  readonly flags: ReadonlyArray<PostHogFeatureFlagKey>;
  readonly message: string;
}> {}

export interface IReleaseGate {
  /**
   * Whether the gate is open, for output never stored: content after
   * `connection()`, Server Actions, route and API responses, and runs. Only
   * `true` opens it. A flag PostHog omits or can't evaluate keeps it closed
   * and is logged once as unavailable.
   */
  readonly isOpen: Effect.Effect<boolean>;
  /**
   * Whether the gate is open, for output that can be stored: a static shell,
   * metadata, a cached loader, or a list of published pages. Explicit
   * `false` closes it. A flag PostHog can't decide fails, logged once, so
   * the stored output keeps its last good version.
   */
  readonly decision: Effect.Effect<boolean, ReleaseGateUnavailableError>;
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
 * `Default` decides the gate at most once per build of the layer for each
 * kind of read, so one run sees one decision; never put it in a
 * process-wide runtime layer. Request code that must agree with its page
 * provides the request's memoized decision instead (`releaseGateForRequest`
 * in `release-gate.server.ts`).
 */
export const ReleaseGate =
  <Self>() =>
  <const Identifier extends string>(
    identifier: Identifier,
    flag: PostHogFeatureFlagKey
  ) =>
    class Gate extends Context.Service<Self, IReleaseGate>()(identifier) {
      /** The flags the gate reads. */
      static readonly flags: ReadonlyArray<PostHogFeatureFlagKey> = [flag];

      /** The provided gate's fail-closed answer. */
      static readonly isOpen: Effect.Effect<boolean, never, Self> =
        Effect.flatMap(this, (gate) => gate.isOpen);

      /** The provided gate's answer for output that can be stored. */
      static readonly decision: Effect.Effect<
        boolean,
        ReleaseGateUnavailableError,
        Self
      > = Effect.flatMap(this, (gate) => gate.decision);

      // The two reads are memoized apart: when no classification could be
      // read, `decision` fails at once while `isOpen` still asks PostHog.
      // Both share the request's one remote evaluation.
      static readonly Default = Layer.effect(
        this,
        WorkspaceFeatureFlagService.pipe(
          Effect.flatMap((featureFlags) =>
            Effect.all({
              isOpen: cached(
                featureFlags
                  .isEnabled(flag)
                  .pipe(closeUnavailableRelease([flag], false))
              ),
              decision: cached(
                featureFlags.decision(flag).pipe(failUnavailableRelease([flag]))
              ),
            })
          )
        )
      );

      static readonly Live = this.Default.pipe(
        Layer.provide(WorkspaceFeatureFlagService.Default)
      );

      /** A decision the caller already made, such as for a cached render. */
      static readonly fromDecision = (open: boolean) =>
        Layer.succeed(this, {
          isOpen: Effect.succeed(open),
          decision: Effect.succeed(open),
        });

      /**
       * A gate that answers with the given reads, such as the request's
       * memoized decisions; `decision` answers as `isOpen` unless given.
       * Each keeps the gate's policy itself.
       */
      static readonly fromEvaluation = (
        isOpen: Effect.Effect<boolean>,
        decision: Effect.Effect<boolean, ReleaseGateUnavailableError> = isOpen
      ) => Layer.succeed(this, { isOpen, decision });

      /**
       * Whether the gate is open for every visitor, read without the request,
       * so static output can describe it. Fails when no classification could
       * be read.
       */
      static readonly release: Effect.Effect<
        GlobalRelease,
        ReleaseGateUnavailableError,
        WorkspaceFeatureFlagService
      > = WorkspaceFeatureFlagService.pipe(
        Effect.flatMap((featureFlags) => featureFlags.constantValue(flag)),
        Effect.map(globalRelease),
        failUnavailableRelease([flag])
      );
    };

/** The class `ReleaseGate` declares for a feature's gate. */
export interface ReleaseGateClass<Self> {
  readonly flags: ReadonlyArray<PostHogFeatureFlagKey>;
  readonly isOpen: Effect.Effect<boolean, never, Self>;
  readonly decision: Effect.Effect<boolean, ReleaseGateUnavailableError, Self>;
  readonly Live: Layer.Layer<Self>;
  readonly fromDecision: (open: boolean) => Layer.Layer<Self>;
  readonly fromEvaluation: (
    isOpen: Effect.Effect<boolean>,
    decision?: Effect.Effect<boolean, ReleaseGateUnavailableError>
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

/**
 * Fails with `ReleaseGateUnavailableError` when the flags' evaluation fails,
 * logging the failure once with the flag keys. The provider cause stays out
 * of the log.
 */
export const failUnavailableRelease =
  (flags: ReadonlyArray<PostHogFeatureFlagKey>) =>
  <A, E, R>(
    evaluation: Effect.Effect<A, E, R>
  ): Effect.Effect<A, ReleaseGateUnavailableError, R> =>
    evaluation.pipe(
      Effect.mapError(
        () =>
          new ReleaseGateUnavailableError({
            flags,
            message: "PostHog couldn't decide the release gate.",
          })
      ),
      Effect.tapError(() =>
        logUnavailableRelease(flags, "evaluation_failed", "fails")
      )
    );

const logUnavailableRelease = (
  flags: ReadonlyArray<PostHogFeatureFlagKey>,
  reason: "omitted" | "evaluation_failed",
  outcome: "stays_closed" | "fails" = "stays_closed"
) =>
  Effect.logWarning(
    outcome === "fails"
      ? "Release gate unavailable; the read fails"
      : "Release gate unavailable; it stays closed"
  ).pipe(
    Effect.annotateLogs({
      releaseGateFlags: flags,
      releaseGateReason: reason,
    })
  );
