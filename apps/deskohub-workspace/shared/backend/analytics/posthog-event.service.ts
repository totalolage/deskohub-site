import "server-only";

import type {
  PostHogDistinctId,
  PostHogEventId,
} from "@deskohub/posthog/identifiers";
import { Context, Effect, Layer, Option, Predicate } from "effect";
import { type EventMessage, PostHog } from "posthog-node";
import {
  PostHogRuntimeConfig,
  type PostHogRuntimeConfigObj,
} from "@/shared/backend/config/posthog.config";
import { temporalInstantToDate } from "@/shared/utils/temporal";

type PostHogEventProperty = string | number | boolean | null;

export type PostHogEventProperties = Readonly<
  Record<string, PostHogEventProperty | undefined>
>;

export interface CapturePostHogEventInput {
  readonly distinctId: PostHogDistinctId;
  readonly event: string;
  readonly properties?: PostHogEventProperties;
  readonly timestamp: Temporal.Instant;
  readonly uuid: PostHogEventId;
}

export interface IPostHogEventService {
  readonly alias: (input: {
    readonly alias: PostHogDistinctId;
    readonly distinctId: PostHogDistinctId;
  }) => Effect.Effect<void>;
  readonly capture: (input: CapturePostHogEventInput) => Effect.Effect<void>;
}

interface PostHogCaptureClient {
  readonly aliasImmediate: (message: {
    readonly alias: string;
    readonly distinctId: string;
  }) => Promise<void>;
  readonly captureImmediate: (message: EventMessage) => Promise<void>;
}

interface PostHogEventServiceOptions {
  readonly client?: PostHogCaptureClient;
  readonly config: PostHogRuntimeConfigObj;
}

export class PostHogEventService extends Context.Service<
  PostHogEventService,
  IPostHogEventService
>()("@deskohub-workspace/analytics/PostHogEventService") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const config = yield* PostHogRuntimeConfig;
      return makePostHogEventService({
        client: createPostHogCaptureClient(config),
        config,
      });
    })
  );

  static Live = this.Default.pipe(Layer.provide(PostHogRuntimeConfig.Default));
}

const createPostHogCaptureClient = ({
  ingestHost,
  projectToken,
}: PostHogRuntimeConfigObj): PostHogCaptureClient | undefined => {
  if (!projectToken) return undefined;
  return new PostHog(projectToken, { host: ingestHost });
};

const collectSpanMetadata = Effect.gen(function* () {
  const currentSpan = yield* Effect.currentSpan.pipe(Effect.option);
  return Option.isSome(currentSpan)
    ? {
        "effect.span_id": currentSpan.value.spanId,
        "effect.trace_id": currentSpan.value.traceId,
      }
    : {};
});

const compactProperties = (properties: PostHogEventProperties | undefined) =>
  Object.fromEntries(
    Object.entries(properties ?? {}).filter(
      ([, value]) =>
        value === null ||
        Predicate.isString(value) ||
        Predicate.isNumber(value) ||
        Predicate.isBoolean(value)
    )
  ) as PostHogEventProperties;

export const makePostHogEventService = ({
  client,
  config,
}: PostHogEventServiceOptions): IPostHogEventService => {
  return {
    alias: (input) =>
      client
        ? Effect.tryPromise(() => client.aliasImmediate(input)).pipe(
            Effect.catch((cause) =>
              Effect.logWarning("PostHog identity alias capture failed", {
                cause,
              })
            )
          )
        : Effect.void,
    capture: (input) =>
      Effect.gen(function* () {
        if (!client) return;

        const spanMetadata = yield* collectSpanMetadata;
        const properties = compactProperties({
          ...input.properties,
          ...spanMetadata,
          "deployment.environment.name": config.environment,
          "service.name": config.serviceName,
          "service.namespace": config.serviceNamespace,
        });

        yield* Effect.tryPromise(() =>
          client.captureImmediate({
            distinctId: input.distinctId,
            event: input.event,
            properties,
            timestamp: temporalInstantToDate(input.timestamp),
            uuid: input.uuid,
          })
        ).pipe(
          Effect.catch((cause) =>
            Effect.logWarning("PostHog lifecycle event capture failed", {
              event: input.event,
              uuid: input.uuid,
              cause,
            })
          )
        );
      }),
  };
};
