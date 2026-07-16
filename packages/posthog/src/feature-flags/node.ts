import { Data, Effect } from "effect";
import { PostHog } from "posthog-node";
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
  readonly disableGeoip?: boolean;
  readonly featureFlagsRequestTimeoutMs?: number;
  readonly host: string;
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
  const evaluateFlags = Effect.fn("PostHogNodeFeatureFlags.evaluateFlags")(
    (
      input: PostHogFeatureFlagEvaluationInput<Definitions>
    ): Effect.Effect<
      TypedPostHogFeatureFlagEvaluationSnapshot<Definitions>,
      PostHogFeatureFlagEvaluationError
    > =>
      Effect.succeed({ config, contract, input }).pipe(
        Effect.let("evaluationInput", prepareFeatureFlagEvaluation),
        Effect.bind("client", createPostHogClient),
        Effect.bind("evaluation", evaluatePostHogFeatureFlags),
        Effect.map(({ evaluation }) => evaluation)
      )
  );

  const isEnabled = Effect.fn("PostHogNodeFeatureFlags.isEnabled")(
    <Key extends PostHogFeatureFlagKey<Definitions>>({
      key,
      subject,
    }: {
      readonly key: Key;
      readonly subject: PostHogFeatureFlagSubject;
    }) =>
      evaluateFlags({
        options: {
          flagKeys: [key],
        },
        subject,
      }).pipe(Effect.map((flags) => flags.isEnabled(key)))
  );

  return { evaluateFlags, isEnabled };
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
      readonly sendFeatureFlagEvents?: boolean;
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
  readonly sendFeatureFlagEvents?: boolean;
}

export interface PostHogFeatureFlagEvaluationInput<Definitions> {
  readonly options?: Omit<
    PostHogFeatureFlagEvaluationOptions<Definitions>,
    "sendFeatureFlagEvents"
  >;
  readonly subject: PostHogFeatureFlagSubject;
}

interface PreparedPostHogFeatureFlagEvaluationInput<Definitions> {
  readonly options: PostHogFeatureFlagEvaluationOptions<Definitions>;
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
        client.evaluateFlags(distinctId, {
          disableGeoip: options?.disableGeoip,
          flagKeys: options?.flagKeys ? [...options.flagKeys] : undefined,
          groupProperties: options?.groupProperties,
          groups: options?.groups,
          onlyEvaluateLocally: options?.onlyEvaluateLocally,
          personProperties: options?.personProperties,
          sendFeatureFlagEvents: options?.sendFeatureFlagEvents,
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

const createPostHogClient = Effect.fn("PostHogNodeFeatureFlags.createClient")(
  ({ config }: { readonly config: PostHogNodeFeatureFlagServiceConfig }) =>
    Effect.try({
      try: () => {
        if (!config.projectToken) {
          throw new Error("PostHog project token is not configured.");
        }

        return new PostHog(config.projectToken, {
          featureFlagsRequestTimeoutMs: config.featureFlagsRequestTimeoutMs,
          host: config.host,
        });
      },
      catch: (cause) =>
        new PostHogFeatureFlagEvaluationError({
          message: "Could not initialize the PostHog feature flag client.",
          cause,
        }),
    })
);

const prepareFeatureFlagEvaluation = <Definitions>({
  config,
  input,
}: {
  readonly config: PostHogNodeFeatureFlagServiceConfig;
  readonly input: PostHogFeatureFlagEvaluationInput<Definitions>;
}): PreparedPostHogFeatureFlagEvaluationInput<Definitions> => ({
  options: {
    ...input.options,
    disableGeoip: input.options?.disableGeoip ?? config.disableGeoip,
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
    readonly client: PostHog;
    readonly contract: PostHogFeatureFlagContract<Definitions>;
    readonly evaluationInput: PreparedPostHogFeatureFlagEvaluationInput<Definitions>;
  }) =>
    createPostHogNodeFeatureFlags(contract, client)
      .evaluateFlags(
        evaluationInput.subject.distinctId,
        evaluationInput.options
      )
      .pipe(Effect.ensuring(shutdownPostHogClient({ client })))
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
  }).pipe(
    Effect.catch((error) =>
      Effect.logWarning(error.message, { cause: error.cause })
    )
  )
);
