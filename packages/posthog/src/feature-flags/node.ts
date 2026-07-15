import { Data, Effect } from "effect";
import type {
  PostHogFeatureFlagContract,
  PostHogFeatureFlagDefinitionContract,
  PostHogFeatureFlagKey,
  PostHogFeatureFlagPayload,
  PostHogFeatureFlagValue,
} from "./contract";

type ValidDefinitions<Definitions> = {
  readonly [Key in keyof Definitions]: PostHogFeatureFlagDefinitionContract;
};

export interface PostHogFeatureFlagEvaluationSnapshot {
  readonly getFlag: (key: string) => boolean | string | undefined;
  readonly getFlagPayload: (key: string) => unknown;
  readonly isEnabled: (key: string) => boolean;
}

export interface PostHogFeatureFlagEvaluationClient {
  readonly evaluateFlags: (
    distinctId: string,
    options?: {
      readonly disableGeoip?: boolean;
      readonly flagKeys?: string[];
      readonly groupProperties?: Record<string, Record<string, string>>;
      readonly groups?: Record<string, string>;
      readonly onlyEvaluateLocally?: boolean;
      readonly personProperties?: Record<string, string>;
    }
  ) => Promise<PostHogFeatureFlagEvaluationSnapshot>;
}

export interface PostHogFeatureFlagEvaluationOptions<Definitions> {
  readonly disableGeoip?: boolean;
  readonly flagKeys?: readonly PostHogFeatureFlagKey<Definitions>[];
  readonly groupProperties?: Record<string, Record<string, string>>;
  readonly groups?: Record<string, string>;
  readonly onlyEvaluateLocally?: boolean;
  readonly personProperties?: Record<string, string>;
}

export class PostHogFeatureFlagEvaluationError extends Data.TaggedError(
  "PostHogFeatureFlagEvaluationError"
)<{
  readonly cause: unknown;
  readonly message: string;
}> {}

export interface TypedPostHogFeatureFlagEvaluationSnapshot<Definitions> {
  readonly getFlag: <Key extends PostHogFeatureFlagKey<Definitions>>(
    key: Key
  ) => PostHogFeatureFlagValue<Definitions, Key> | undefined;
  readonly getFlagPayload: <Key extends PostHogFeatureFlagKey<Definitions>>(
    key: Key
  ) => PostHogFeatureFlagPayload<Definitions, Key>;
  readonly isEnabled: <Key extends PostHogFeatureFlagKey<Definitions>>(
    key: Key
  ) => boolean;
  readonly raw: PostHogFeatureFlagEvaluationSnapshot;
}

export const createPostHogNodeFeatureFlags = <
  const Definitions extends ValidDefinitions<Definitions>,
>(
  _contract: PostHogFeatureFlagContract<Definitions>,
  client: PostHogFeatureFlagEvaluationClient
) => ({
  evaluateFlags: (
    distinctId: string,
    options?: PostHogFeatureFlagEvaluationOptions<Definitions>
  ): Effect.Effect<
    TypedPostHogFeatureFlagEvaluationSnapshot<Definitions>,
    PostHogFeatureFlagEvaluationError
  > =>
    Effect.tryPromise({
      try: () =>
        client.evaluateFlags(distinctId, {
          disableGeoip: options?.disableGeoip,
          flagKeys: options?.flagKeys ? [...options.flagKeys] : undefined,
          groupProperties: options?.groupProperties,
          groups: options?.groups,
          onlyEvaluateLocally: options?.onlyEvaluateLocally,
          personProperties: options?.personProperties,
        }),
      catch: (cause) =>
        new PostHogFeatureFlagEvaluationError({
          message: "Could not evaluate PostHog feature flags.",
          cause,
        }),
    }).pipe(
      Effect.map((snapshot) => ({
        getFlag: <Key extends PostHogFeatureFlagKey<Definitions>>(key: Key) =>
          snapshot.getFlag(key) as
            | PostHogFeatureFlagValue<Definitions, Key>
            | undefined,
        getFlagPayload: <Key extends PostHogFeatureFlagKey<Definitions>>(
          key: Key
        ) =>
          snapshot.getFlagPayload(key) as PostHogFeatureFlagPayload<
            Definitions,
            Key
          >,
        isEnabled: (key) => snapshot.isEnabled(key),
        raw: snapshot,
      }))
    ),
});
