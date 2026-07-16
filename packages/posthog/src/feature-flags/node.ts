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
  PostHogFeatureFlagPayload,
  PostHogFeatureFlagValue,
} from "./contract";

type ValidDefinitions<Definitions> = {
  readonly [Key in keyof Definitions]: PostHogFeatureFlagDefinitionContract;
};

export interface PostHogNodeFeatureFlagServiceConfig {
  readonly clientOptions?: PostHogOptions;
  readonly defaultEvaluationOptions?: Omit<AllFlagsOptions, "flagKeys">;
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
  config: PostHogNodeFeatureFlagServiceConfig
) => {
  let client: PostHog | undefined;

  const getClient = Effect.fn("PostHogNodeFeatureFlags.getClient")(() => {
    if (client) {
      return Effect.succeed(client);
    }
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
        client = new PostHog(projectToken, config.clientOptions);
        return client;
      },
      catch: (cause) =>
        new PostHogFeatureFlagEvaluationError({
          message: "Could not initialize the PostHog feature flag client.",
          cause,
        }),
    });
  });

  const evaluateFlags = Effect.fn("PostHogNodeFeatureFlags.evaluateFlags")(
    (
      input: PostHogFeatureFlagEvaluationInput<Definitions>
    ): Effect.Effect<
      TypedPostHogFeatureFlagEvaluationSnapshot<Definitions>,
      PostHogFeatureFlagEvaluationError
    > =>
      Effect.succeed({ config, contract, input }).pipe(
        Effect.let("evaluationInput", prepareFeatureFlagEvaluation),
        Effect.bind("client", getClient),
        Effect.bind("evaluation", evaluatePostHogFeatureFlags),
        Effect.map(({ evaluation }) => evaluation)
      )
  );

  const isEnabled = Effect.fn("PostHogNodeFeatureFlags.isEnabled")(
    <Key extends PostHogFeatureFlagKey<Definitions>>(
      input: PostHogFeatureFlagCheckInput<Definitions, Key>
    ) =>
      Effect.succeed({ config, input }).pipe(
        Effect.let("checkInput", prepareFeatureFlagCheck),
        Effect.bind("client", getClient),
        Effect.bind("result", evaluatePostHogFeatureFlag),
        Effect.map(({ result }) => result?.enabled ?? false)
      )
  );

  const shutdown = Effect.fn("PostHogNodeFeatureFlags.shutdown")(() => {
    const currentClient = client;
    client = undefined;
    return currentClient
      ? shutdownPostHogClient({ client: currentClient })
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
  readonly distinctId: string;
  readonly options?: PostHogFeatureFlagEvaluationOptions<Definitions>;
}

export interface PostHogFeatureFlagCheckInput<
  Definitions,
  Key extends PostHogFeatureFlagKey<Definitions>,
> {
  readonly key: Key;
  readonly options?: Omit<FlagEvaluationOptions, "sendFeatureFlagEvents">;
  readonly subject: PostHogFeatureFlagSubject;
}

interface PreparedPostHogFeatureFlagEvaluationInput<Definitions> {
  readonly distinctId: string;
  readonly options: PostHogFeatureFlagEvaluationOptions<Definitions>;
}

interface PreparedPostHogFeatureFlagCheckInput<
  Definitions,
  Key extends PostHogFeatureFlagKey<Definitions>,
> {
  readonly key: Key;
  readonly options: FlagEvaluationOptions;
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

const prepareFeatureFlagEvaluation = <Definitions>({
  config,
  input,
}: {
  readonly config: PostHogNodeFeatureFlagServiceConfig;
  readonly input: PostHogFeatureFlagEvaluationInput<Definitions>;
}): PreparedPostHogFeatureFlagEvaluationInput<Definitions> => ({
  distinctId: input.distinctId,
  options: {
    ...config.defaultEvaluationOptions,
    ...input.options,
  },
});

const prepareFeatureFlagCheck = <
  Definitions,
  Key extends PostHogFeatureFlagKey<Definitions>,
>({
  config,
  input,
}: {
  readonly config: PostHogNodeFeatureFlagServiceConfig;
  readonly input: PostHogFeatureFlagCheckInput<Definitions, Key>;
}): PreparedPostHogFeatureFlagCheckInput<Definitions, Key> => ({
  key: input.key,
  options: {
    ...config.defaultEvaluationOptions,
    ...input.options,
    sendFeatureFlagEvents: input.subject.sendFeatureFlagEvents,
  },
  subject: input.subject,
});

const evaluatePostHogFeatureFlags = Effect.fn(
  "PostHogNodeFeatureFlags.evaluateFlags"
)(
  <Definitions extends ValidDefinitions<Definitions>>({
    client,
    contract,
    evaluationInput,
  }: {
    readonly client: PostHogFeatureFlagEvaluationClient;
    readonly contract: PostHogFeatureFlagContract<Definitions>;
    readonly evaluationInput: PreparedPostHogFeatureFlagEvaluationInput<Definitions>;
  }) =>
    createPostHogNodeFeatureFlags(contract, client).evaluateFlags(
      evaluationInput.distinctId,
      evaluationInput.options
    )
);

const evaluatePostHogFeatureFlag = Effect.fn(
  "PostHogNodeFeatureFlags.evaluateFlag"
)(
  <Definitions, Key extends PostHogFeatureFlagKey<Definitions>>({
    checkInput,
    client,
  }: {
    readonly checkInput: PreparedPostHogFeatureFlagCheckInput<Definitions, Key>;
    readonly client: PostHog;
  }) =>
    Effect.tryPromise({
      try: () =>
        client.getFeatureFlagResult(
          checkInput.key,
          checkInput.subject.distinctId,
          checkInput.options
        ),
      catch: (cause) =>
        new PostHogFeatureFlagEvaluationError({
          message: "Could not evaluate the PostHog feature flag.",
          cause,
        }),
    })
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
