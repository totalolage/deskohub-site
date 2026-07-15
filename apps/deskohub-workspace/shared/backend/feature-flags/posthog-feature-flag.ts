import "server-only";

import type {
  PostHogFeatureFlagKey,
  PostHogFeatureFlagValue,
} from "@deskohub/posthog/feature-flags";
import { Data, Effect } from "effect";

export interface PostHogFeatureFlagClient {
  readonly evaluateFlags: (
    distinctId: string,
    options: {
      readonly disableGeoip: boolean;
      readonly flagKeys: string[];
    }
  ) => Promise<{ readonly isEnabled: (key: string) => boolean }>;
  readonly shutdown: () => Promise<void>;
}

type BooleanPostHogFeatureFlagKey = {
  [Key in PostHogFeatureFlagKey]: PostHogFeatureFlagValue<Key> extends boolean
    ? Key
    : never;
}[PostHogFeatureFlagKey];

type IsPostHogFeatureFlagEnabledOptions = {
  readonly client: PostHogFeatureFlagClient;
  readonly distinctId: string;
  readonly key: BooleanPostHogFeatureFlagKey;
};

export class PostHogFeatureFlagEvaluationError extends Data.TaggedError(
  "PostHogFeatureFlagEvaluationError"
)<{
  readonly cause: unknown;
  readonly message: string;
}> {}

export const isPostHogFeatureFlagEnabled = Effect.fn(
  "isPostHogFeatureFlagEnabled"
)(function* ({ client, distinctId, key }: IsPostHogFeatureFlagEnabledOptions) {
  const shutdown = Effect.tryPromise({
    try: () => client.shutdown(),
    catch: (cause) =>
      new PostHogFeatureFlagEvaluationError({
        message: "Could not shut down the PostHog feature flag client.",
        cause,
      }),
  }).pipe(
    Effect.catch((error) =>
      Effect.logWarning(error.message, { cause: error.cause })
    )
  );

  const flags = yield* Effect.tryPromise({
    try: () =>
      client.evaluateFlags(distinctId, {
        disableGeoip: true,
        flagKeys: [key],
      }),
    catch: (cause) =>
      new PostHogFeatureFlagEvaluationError({
        message: "Could not evaluate the PostHog feature flag.",
        cause,
      }),
  }).pipe(Effect.ensuring(shutdown));

  return flags.isEnabled(key);
});
