import "server-only";

import {
  createPostHogNodeFeatureFlags,
  PostHogFeatureFlagEvaluationError,
} from "@deskohub/posthog/feature-flags/node";
import { Context, Effect, Layer } from "effect";
import { PostHog } from "posthog-node";
import {
  PostHogRuntimeConfig,
  type PostHogRuntimeConfigObj,
} from "@/shared/backend/config/posthog.config";
import {
  type PostHogFeatureFlagKey,
  postHogFeatureFlags,
} from "../generated/contract";

export interface IsFeatureFlagEnabledInput {
  readonly distinctId: string;
  readonly key: PostHogFeatureFlagKey;
}

export interface IFeatureFlagService {
  readonly isEnabled: (
    input: IsFeatureFlagEnabledInput
  ) => Effect.Effect<boolean, PostHogFeatureFlagEvaluationError>;
}

export class FeatureFlagService extends Context.Service<
  FeatureFlagService,
  IFeatureFlagService
>()("@deskohub-workspace/feature-flags/FeatureFlagService") {
  static Live = Layer.effect(this, featureFlagServiceImplementation());
}

function featureFlagServiceImplementation() {
  return Effect.Do.pipe(
    Effect.bind("config", () => PostHogRuntimeConfig),
    Effect.map(({ config }) => {
      const isEnabled = Effect.fn("FeatureFlagService.isEnabled")(
        (input: IsFeatureFlagEnabledInput) => {
          if (!config.projectToken) return Effect.succeed(false);

          return Effect.succeed({
            config,
            input,
            projectToken: config.projectToken,
          }).pipe(
            Effect.bind("configuredClient", createConfiguredClient),
            Effect.bind("evaluation", evaluateFeatureFlag),
            Effect.map(({ evaluation, input: { key } }) =>
              evaluation.isEnabled(key)
            )
          );
        }
      );

      return { isEnabled } satisfies IFeatureFlagService;
    })
  );
}

const createConfiguredClient = Effect.fn(
  "FeatureFlagService.createConfiguredClient"
)(
  ({
    config,
    projectToken,
  }: {
    readonly config: PostHogRuntimeConfigObj;
    readonly projectToken: string;
  }) =>
    Effect.try({
      try: () => {
        const client = new PostHog(projectToken, {
          featureFlagsRequestTimeoutMs: 2_000,
          host: config.host,
        });

        return {
          client,
          featureFlags: createPostHogNodeFeatureFlags(
            postHogFeatureFlags,
            client
          ),
        };
      },
      catch: (cause) =>
        new PostHogFeatureFlagEvaluationError({
          message: "Could not initialize the PostHog feature flag client.",
          cause,
        }),
    })
);

const evaluateFeatureFlag = Effect.fn("FeatureFlagService.evaluateFeatureFlag")(
  ({
    configuredClient,
    input,
  }: {
    readonly configuredClient: Effect.Success<
      ReturnType<typeof createConfiguredClient>
    >;
    readonly input: IsFeatureFlagEnabledInput;
  }) =>
    configuredClient.featureFlags
      .evaluateFlags(input.distinctId, {
        disableGeoip: true,
        flagKeys: [input.key],
      })
      .pipe(
        Effect.ensuring(
          shutdownPostHogClient({ client: configuredClient.client })
        )
      )
);

const shutdownPostHogClient = Effect.fn("FeatureFlagService.shutdownClient")(
  ({ client }: { readonly client: PostHog }) =>
    Effect.tryPromise({
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
    )
);
