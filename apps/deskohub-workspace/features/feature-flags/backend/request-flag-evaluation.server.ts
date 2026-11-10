import "server-only";

import type { PostHogFeatureFlagOverrides } from "@deskohub/posthog/feature-flags";
import {
  PostHogFeatureFlagEvaluationError,
  type PostHogFeatureFlagSubject,
  type TypedPostHogFeatureFlagEvaluationSnapshot,
} from "@deskohub/posthog/feature-flags/node";
import type { PostHogDistinctId } from "@deskohub/posthog/identifiers";
import { Cache, Deferred, Effect, Exit } from "effect";
import {
  type PostHogFeatureFlagDefinitions,
  type PostHogFeatureFlagKey,
  postHogFeatureFlags,
} from "../generated/contract";
import { getGlobalWorkspaceFeatureFlagValue } from "./feature-flag-evaluation-mode.server";
import { nodeFeatureFlags } from "./node";
import { readRemoteEvaluationPolicy } from "./remote-evaluation-policy.server";
import {
  type FeatureFlagAudience,
  getCurrentFeatureFlagAudience,
  workspaceReleaseSubject,
} from "./subject";

/** Every contract flag's value for one audience; none when unavailable. */
export type RequestFlagValues = Pick<
  TypedPostHogFeatureFlagEvaluationSnapshot<PostHogFeatureFlagDefinitions>,
  "getFlag"
>;

type ConstantFlagValues =
  PostHogFeatureFlagOverrides<PostHogFeatureFlagDefinitions>;

type SharedEvaluations = Map<
  string,
  Deferred.Deferred<RequestFlagValues, PostHogFeatureFlagEvaluationError>
>;

/**
 * Reads every contract flag for the current audience: constants and
 * overrides locally, every other flag in one remote evaluation. The request's
 * Server Components, Server Actions, route handlers and layers share that
 * evaluation; a run outside any request shares it within `run`, which the
 * caller keeps for one run.
 */
export const evaluateRequestFlags = (
  run: SharedEvaluations
): Effect.Effect<RequestFlagValues, PostHogFeatureFlagEvaluationError> =>
  Effect.suspend(() => getCurrentFeatureFlagAudience()).pipe(
    Effect.flatMap((audience) =>
      shareEvaluation(
        evaluationsOf(audience, run),
        audience.subject.distinctId,
        evaluateForSubject(audience.subject)
      )
    )
  );

/**
 * Whether the flag is on for the audience: only `true` is. A flag PostHog
 * didn't evaluate is a failed lookup, so a gate over it closes as
 * unavailable.
 */
export const isFlagEnabled = (
  flags: RequestFlagValues,
  key: PostHogFeatureFlagKey
): Effect.Effect<boolean, PostHogFeatureFlagEvaluationError> => {
  const value = flags.getFlag(key);
  return value === undefined
    ? Effect.fail(
        new PostHogFeatureFlagEvaluationError({
          message: "PostHog did not evaluate the feature flag.",
          cause: undefined,
        })
      )
    : Effect.succeed(value === true);
};

/** The evaluations one run outside any request shares. */
export const makeRunEvaluations = (): SharedEvaluations => new Map();

const requestEvaluations = new WeakMap<WeakKey, SharedEvaluations>();

const evaluationsOf = (
  { request }: FeatureFlagAudience,
  run: SharedEvaluations
): SharedEvaluations => {
  if (request === undefined) return run;
  const existing = requestEvaluations.get(request);
  if (existing) return existing;
  const created: SharedEvaluations = new Map();
  requestEvaluations.set(request, created);
  return created;
};

/**
 * The first evaluation for `key` answers every later one, concurrent ones
 * included. It runs detached, so a consumer that is interrupted only stops
 * waiting; PostHog's request timeout bounds it.
 */
const shareEvaluation = (
  evaluations: SharedEvaluations,
  key: string,
  evaluation: Effect.Effect<
    RequestFlagValues,
    PostHogFeatureFlagEvaluationError
  >
): Effect.Effect<RequestFlagValues, PostHogFeatureFlagEvaluationError> =>
  Effect.suspend(() => {
    const existing = evaluations.get(key);
    if (existing) return Deferred.await(existing);
    // Claimed synchronously, so evaluations that start meanwhile wait for it.
    const result = Deferred.makeUnsafe<
      RequestFlagValues,
      PostHogFeatureFlagEvaluationError
    >();
    evaluations.set(key, result);
    return Effect.forkDetach(Deferred.into(evaluation, result)).pipe(
      Effect.andThen(Deferred.await(result))
    );
  });

const evaluateForSubject = (subject: PostHogFeatureFlagSubject) =>
  readConstantFlagValues.pipe(
    Effect.flatMap((constants) => {
      const remoteKeys = postHogFeatureFlags.keys.filter(
        (key) => constants[key] === undefined
      );
      return evaluateRemotely(subject, remoteKeys).pipe(
        Effect.map(
          (remote): RequestFlagValues => ({
            getFlag: (key) => constants[key] ?? remote.getFlag(key),
          })
        )
      );
    })
  );

const readConstantFlagValues = Effect.promise(() =>
  Promise.all(
    postHogFeatureFlags.keys.map(
      async (key) =>
        [key, await getGlobalWorkspaceFeatureFlagValue(key)] as const
    )
  )
).pipe(
  Effect.map(
    (entries): ConstantFlagValues =>
      Object.fromEntries(entries.filter(([, value]) => value !== undefined))
  )
);

const noFlagValues: RequestFlagValues = { getFlag: () => undefined };

const evaluateRemotely = (
  subject: PostHogFeatureFlagSubject,
  keys: ReadonlyArray<PostHogFeatureFlagKey>
): Effect.Effect<RequestFlagValues, PostHogFeatureFlagEvaluationError> => {
  if (keys.length === 0) return Effect.succeed(noFlagValues);
  if (readRemoteEvaluationPolicy() === "disabled") {
    return closeWithoutRemoteEvaluation(keys);
  }
  return subject.distinctId === workspaceReleaseSubject.distinctId
    ? readGlobalReleaseEvaluation({
        distinctId: subject.distinctId,
        flagKeys: [...keys].sort(),
      })
    : evaluateSubjectRemotely(subject, keys);
};

const evaluateSubjectRemotely = (
  subject: PostHogFeatureFlagSubject,
  flagKeys: ReadonlyArray<PostHogFeatureFlagKey>
): Effect.Effect<RequestFlagValues, PostHogFeatureFlagEvaluationError> =>
  nodeFeatureFlags.evaluateFlags({ options: { flagKeys }, subject });

const disabledFlagsWarned = new Set<PostHogFeatureFlagKey>();

/**
 * Closes every flag that would need PostHog. Each flag is logged the first
 * time this isolate closes it.
 */
const closeWithoutRemoteEvaluation = (
  keys: ReadonlyArray<PostHogFeatureFlagKey>
): Effect.Effect<RequestFlagValues> =>
  Effect.forEach(
    keys.filter((key) => !disabledFlagsWarned.has(key)),
    (key) =>
      Effect.sync(() => disabledFlagsWarned.add(key)).pipe(
        Effect.andThen(
          Effect.logWarning(
            "Remote feature flag evaluation is disabled; the flag stays closed"
          )
        ),
        Effect.annotateLogs({
          code: "feature_flags.remote_evaluation_disabled",
          featureFlag: key,
        })
      ),
    { discard: true }
  ).pipe(Effect.as(closedFlagValues(keys)));

const closedFlagValues = (
  keys: ReadonlyArray<PostHogFeatureFlagKey>
): RequestFlagValues => {
  const closed: ConstantFlagValues = Object.fromEntries(
    keys.map((key) => [key, false])
  );
  return { getFlag: (key) => closed[key] };
};

interface GlobalReleaseEvaluation {
  readonly distinctId: PostHogDistinctId;
  /** Sorted, so one key set is one entry. */
  readonly flagKeys: ReadonlyArray<PostHogFeatureFlagKey>;
}

/** How long an isolate reuses the global subject's complete evaluation. */
export const globalReleaseEvaluationLifetime = "60 seconds";
/** How long it reuses a failed or incomplete one before asking again. */
export const unavailableGlobalReleaseEvaluationLifetime = "15 seconds";

let globalReleaseEvaluations:
  | Cache.Cache<
      GlobalReleaseEvaluation,
      RequestFlagValues,
      PostHogFeatureFlagEvaluationError
    >
  | undefined;

/**
 * The global subject's evaluation, shared by every request this isolate
 * serves. It's the same for every anonymous visitor while no flag targets
 * persons or groups; a flag that starts targeting must drop this cache.
 */
const readGlobalReleaseEvaluation = (
  evaluation: GlobalReleaseEvaluation
): Effect.Effect<RequestFlagValues, PostHogFeatureFlagEvaluationError> =>
  Effect.suspend(() =>
    globalReleaseEvaluations
      ? Effect.succeed(globalReleaseEvaluations)
      : Cache.makeWith(
          ({ distinctId, flagKeys }: GlobalReleaseEvaluation) =>
            // Uninterruptible, so a cancelled request never caches its interruption.
            Effect.uninterruptible(
              evaluateSubjectRemotely(
                { ...workspaceReleaseSubject, distinctId },
                flagKeys
              )
            ),
          {
            capacity: 16,
            timeToLive: (exit, { flagKeys }) =>
              Exit.isSuccess(exit) &&
              flagKeys.every((key) => exit.value.getFlag(key) !== undefined)
                ? globalReleaseEvaluationLifetime
                : unavailableGlobalReleaseEvaluationLifetime,
          }
        ).pipe(
          // A run that raced this one may have kept its cache first.
          Effect.map((created) => (globalReleaseEvaluations ??= created))
        )
  ).pipe(Effect.flatMap((cache) => Cache.get(cache, evaluation)));
