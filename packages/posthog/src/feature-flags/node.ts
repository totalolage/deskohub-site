import { Data, Effect } from "effect";
import {
  type AllFlagsOptions,
  type FeatureFlagEvaluations,
  type FlagEvaluationOptions,
  PostHog,
  type PostHogOptions,
} from "posthog-node";
import type {
  PostHogFeatureFlagContract,
  PostHogFeatureFlagDefinitionContract,
  PostHogFeatureFlagKey,
  PostHogFeatureFlagOverrides,
  PostHogFeatureFlagPayload,
  PostHogFeatureFlagValue,
} from "./contract";

type ValidDefinitions<Definitions> = {
  readonly [Key in keyof Definitions]: PostHogFeatureFlagDefinitionContract;
};

export interface PostHogNodeFeatureFlagServiceConfig<Definitions> {
  readonly clientOptions?: PostHogOptions;
  readonly defaultEvaluationOptions?: Omit<AllFlagsOptions, "flagKeys">;
  readonly featureFlagOverrides?: PostHogFeatureFlagOverrides<Definitions>;
  readonly projectToken?: string;
}

export interface PostHogFeatureFlagSubject {
  readonly distinctId: string;
  readonly sendFeatureFlagEvents: boolean;
}

export const makePostHogNodeFeatureFlagService = <
  const Definitions extends ValidDefinitions<Definitions>,
>(
  contract: PostHogFeatureFlagContract<Definitions>,
  config: PostHogNodeFeatureFlagServiceConfig<Definitions>
) => {
  let client: PostHog | undefined;

  const getClient = Effect.fn("PostHogNodeFeatureFlags.getClient")(() =>
    Effect.suspend(() => {
      if (client) {
        return Effect.succeed(client);
      }

      return createPostHogClient({ config }).pipe(
        Effect.tap((createdClient) =>
          Effect.sync(() => {
            client = createdClient;
          })
        )
      );
    })
  );

  const evaluateFlags = Effect.fn("PostHogNodeFeatureFlags.evaluateFlags")(
    (
      input: PostHogFeatureFlagEvaluationInput<Definitions>
    ): Effect.Effect<
      TypedPostHogFeatureFlagEvaluationSnapshot<Definitions>,
      PostHogFeatureFlagEvaluationError
    > =>
      getClient().pipe(
        Effect.flatMap((postHogClient) => {
          const options = {
            ...config.defaultEvaluationOptions,
            ...input.options,
          };

          return input.subject.sendFeatureFlagEvents
            ? createPostHogNodeFeatureFlags(
                contract,
                postHogClient
              ).evaluateFlags(input.subject.distinctId, options)
            : evaluatePostHogFeatureFlagsWithoutEvents({
                client: postHogClient,
                distinctId: input.subject.distinctId,
                options,
              }).pipe(
                Effect.map((snapshot) =>
                  toTypedPostHogFeatureFlagEvaluationSnapshot<Definitions>(
                    snapshot
                  )
                )
              );
        })
      )
  );

  const isEnabled = Effect.fn("PostHogNodeFeatureFlags.isEnabled")(
    <Key extends PostHogFeatureFlagKey<Definitions>>(
      input: PostHogFeatureFlagCheckInput<Definitions, Key>
    ) =>
      getClient().pipe(
        Effect.flatMap((postHogClient) =>
          Effect.tryPromise({
            try: () =>
              postHogClient.getFeatureFlagResult(
                input.key,
                input.subject.distinctId,
                {
                  ...config.defaultEvaluationOptions,
                  ...input.options,
                  sendFeatureFlagEvents: input.subject.sendFeatureFlagEvents,
                }
              ),
            catch: (cause) =>
              new PostHogFeatureFlagEvaluationError({
                message: "Could not evaluate the PostHog feature flag.",
                cause,
              }),
          })
        ),
        Effect.map((result) => result?.enabled ?? false)
      )
  );

  const shutdown = Effect.suspend(() => {
    const activeClient = client;
    client = undefined;

    return activeClient
      ? shutdownPostHogClient({ client: activeClient }).pipe(
          Effect.catch((error) =>
            Effect.logWarning(error.message, { cause: error.cause })
          )
        )
      : Effect.void;
  });

  return { evaluateFlags, isEnabled, shutdown };
};

export type PostHogFeatureFlagEvaluationSnapshot = Pick<
  FeatureFlagEvaluations,
  "getFlag" | "getFlagPayload" | "isEnabled"
>;

export interface PostHogFeatureFlagEvaluationClient {
  readonly evaluateFlags: (
    distinctId: string,
    options?: AllFlagsOptions
  ) => Promise<PostHogFeatureFlagEvaluationSnapshot>;
}

export type PostHogFeatureFlagEvaluationOptions<Definitions> = Readonly<
  Omit<AllFlagsOptions, "flagKeys"> & {
    readonly flagKeys?: readonly PostHogFeatureFlagKey<Definitions>[];
  }
>;

export interface PostHogFeatureFlagEvaluationInput<Definitions> {
  readonly options?: PostHogFeatureFlagEvaluationOptions<Definitions>;
  readonly subject: PostHogFeatureFlagSubject;
}

export interface PostHogFeatureFlagCheckInput<
  Definitions,
  Key extends PostHogFeatureFlagKey<Definitions>,
> {
  readonly key: Key;
  readonly options?: Omit<FlagEvaluationOptions, "sendFeatureFlagEvents">;
  readonly subject: PostHogFeatureFlagSubject;
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
        client.evaluateFlags(
          distinctId,
          options && {
            ...options,
            flagKeys: options.flagKeys ? [...options.flagKeys] : undefined,
          }
        ),
      catch: (cause) =>
        new PostHogFeatureFlagEvaluationError({
          message: "Could not evaluate PostHog feature flags.",
          cause,
        }),
    }).pipe(
      Effect.map((snapshot) =>
        toTypedPostHogFeatureFlagEvaluationSnapshot<Definitions>(snapshot)
      )
    ),
});

const toTypedPostHogFeatureFlagEvaluationSnapshot = <Definitions>(
  snapshot: PostHogFeatureFlagEvaluationSnapshot
): TypedPostHogFeatureFlagEvaluationSnapshot<Definitions> => ({
  getFlag: <Key extends PostHogFeatureFlagKey<Definitions>>(key: Key) =>
    snapshot.getFlag(key) as
      | PostHogFeatureFlagValue<Definitions, Key>
      | undefined,
  getFlagPayload: <Key extends PostHogFeatureFlagKey<Definitions>>(key: Key) =>
    snapshot.getFlagPayload(key) as PostHogFeatureFlagPayload<Definitions, Key>,
  isEnabled: (key) => snapshot.isEnabled(key),
  raw: snapshot,
});

const evaluatePostHogFeatureFlagsWithoutEvents = Effect.fn(
  "PostHogNodeFeatureFlags.evaluateFlagsWithoutEvents"
)(
  <Definitions>({
    client,
    distinctId,
    options,
  }: {
    readonly client: PostHog;
    readonly distinctId: string;
    readonly options: PostHogFeatureFlagEvaluationOptions<Definitions>;
  }) =>
    Effect.tryPromise({
      try: () =>
        client.getAllFlagsAndPayloads(distinctId, {
          ...options,
          flagKeys: options.flagKeys ? [...options.flagKeys] : undefined,
        }),
      catch: (cause) =>
        new PostHogFeatureFlagEvaluationError({
          message: "Could not evaluate PostHog feature flags.",
          cause,
        }),
    }).pipe(
      Effect.map(({ featureFlags = {}, featureFlagPayloads = {} }) => ({
        getFlag: (key: string) => featureFlags[key],
        getFlagPayload: (key: string) => featureFlagPayloads[key],
        isEnabled: (key: string) => {
          const value = featureFlags[key];
          return value !== undefined && value !== false;
        },
      }))
    )
);

const createPostHogClient = Effect.fn("PostHogNodeFeatureFlags.createClient")(
  <Definitions>({
    config,
  }: {
    readonly config: PostHogNodeFeatureFlagServiceConfig<Definitions>;
  }) => {
    const { projectToken } = config;
    if (!projectToken) {
      const cause = new Error("PostHog project token is not configured.");
      return Effect.fail(
        new PostHogFeatureFlagEvaluationError({
          message: "Could not initialize the PostHog feature flag client.",
          cause,
        })
      );
    }

    return Effect.try({
      try: () => {
        const client = new PostHog(projectToken, config.clientOptions);
        if (config.featureFlagOverrides !== undefined) {
          client.overrideFeatureFlags(config.featureFlagOverrides);
        }
        return client;
      },
      catch: (cause) =>
        new PostHogFeatureFlagEvaluationError({
          message: "Could not initialize the PostHog feature flag client.",
          cause,
        }),
    });
  }
);

const shutdownPostHogClient = Effect.fn(
  "PostHogNodeFeatureFlags.shutdownClient"
)(({ client }: { readonly client: PostHog }) =>
  Effect.tryPromise({
    try: () => client.shutdown(),
    catch: (cause) =>
      new PostHogFeatureFlagEvaluationError({
        message: "Could not shut down the PostHog feature flag client.",
        cause,
      }),
  })
);
