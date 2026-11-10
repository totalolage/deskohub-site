import type {
  PostHogFeatureFlagOverrides,
  PostHogFeatureFlagSnapshot,
} from "@deskohub/posthog/feature-flags";
import {
  type PostHogFeatureFlagDefinition,
  type PostHogFeatureFlagError,
  postHogFeatureFlagFailureLogFields,
} from "@deskohub/posthog/feature-flags/management";
import { Clock, Duration, Effect } from "effect";
import {
  type PostHogFeatureFlagDefinitions,
  type PostHogFeatureFlagKey,
  postHogFeatureFlags,
} from "../generated/contract";

/**
 * How old a fallback classification, the last-known one or the generated
 * snapshot, may be and still stand in for PostHog.
 */
export const featureFlagFallbackMaxAge = Duration.days(7);

/** How far ahead of this clock a fallback's read instant may be. */
const clockSkewAllowance = Duration.minutes(5);

/** The flags whose value is the same for every request. */
export type ConstantFeatureFlagValues =
  PostHogFeatureFlagOverrides<PostHogFeatureFlagDefinitions>;

/**
 * Where a classification's constants came from: PostHog now, the last
 * complete PostHog answer in this process, the generated snapshot, or
 * nowhere, which leaves only the overrides constant.
 */
type FeatureFlagClassificationSource =
  | "live"
  | "last-known"
  | "snapshot"
  | "none";

export interface FeatureFlagClassification {
  readonly source: FeatureFlagClassificationSource;
  /** Constant flags, with the overrides applied last. */
  readonly values: ConstantFeatureFlagValues;
}

/**
 * Classifies the contract flags from PostHog's definitions. When PostHog
 * can't list them, it keeps the last complete answer this process received,
 * else the generated snapshot, each while it's at most
 * `featureFlagFallbackMaxAge` old. Overrides win over every source.
 */
export const makeFeatureFlagClassifier = ({
  snapshot,
}: {
  readonly snapshot:
    | PostHogFeatureFlagSnapshot<PostHogFeatureFlagKey>
    | undefined;
}) => {
  let lastKnown:
    | { readonly constants: ConstantFeatureFlagValues; readonly readAt: number }
    | undefined;
  let reportedUnusableSnapshot = false;

  const fallback = Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    if (lastKnown && isFresh(lastKnown.readAt, now)) {
      return { source: "last-known", constants: lastKnown.constants } as const;
    }

    if (snapshot && isFresh(Date.parse(snapshot.generatedAt), now)) {
      return {
        source: "snapshot",
        constants: contractConstants(Object.entries(snapshot.constantValues)),
      } as const;
    }

    if (!reportedUnusableSnapshot) {
      reportedUnusableSnapshot = true;
      yield* Effect.logWarning(
        "PostHog feature flag snapshot is missing or too old to classify flags.",
        { generatedAt: snapshot?.generatedAt }
      );
    }
    return { source: "none", constants: {} } as const;
  });

  return ({
    definitions,
    overrides,
  }: {
    readonly definitions: Effect.Effect<
      readonly PostHogFeatureFlagDefinition[],
      PostHogFeatureFlagError
    >;
    readonly overrides: ConstantFeatureFlagValues;
  }): Effect.Effect<FeatureFlagClassification> =>
    definitions.pipe(
      Effect.map((definitions) =>
        contractConstants(
          definitions.map(({ constantEnabledValue, key }) => [
            key,
            constantEnabledValue,
          ])
        )
      ),
      Effect.tap((constants) =>
        Clock.currentTimeMillis.pipe(
          Effect.tap((readAt) =>
            Effect.sync(() => {
              lastKnown = { constants, readAt };
            })
          )
        )
      ),
      Effect.map((constants) => ({ source: "live", constants }) as const),
      Effect.catch((error) =>
        Effect.logWarning(
          error.message,
          postHogFeatureFlagFailureLogFields(error)
        ).pipe(Effect.andThen(fallback))
      ),
      Effect.map(
        ({ constants, source }): FeatureFlagClassification => ({
          source,
          values: { ...constants, ...overrides },
        })
      )
    );
};

/** Within the age limit, allowing a little clock skew for future instants. */
const isFresh = (readAt: number, now: number) => {
  const age = now - readAt;
  return (
    age >= -Duration.toMillis(clockSkewAllowance) &&
    age <= Duration.toMillis(featureFlagFallbackMaxAge)
  );
};

/** Keeps the contract keys whose value is constant. */
const contractConstants = (
  entries: Iterable<readonly [string, boolean | null | undefined]>
): ConstantFeatureFlagValues => {
  const values: Partial<Record<PostHogFeatureFlagKey, boolean>> = {};
  for (const [key, value] of entries) {
    if (value === null || value === undefined || !isContractKey(key)) continue;
    values[key] = value;
  }
  return values;
};

const isContractKey = (key: string): key is PostHogFeatureFlagKey =>
  postHogFeatureFlags.keys.includes(key as PostHogFeatureFlagKey);
