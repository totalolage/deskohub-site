import "server-only";

import type {
  PostHogDistinctId,
  PostHogEventId,
} from "@deskohub/posthog/identifiers";
import { Context, Effect, Layer, Option, References } from "effect";
import { type EventMessage, PostHog } from "posthog-node";
import {
  PostHogRuntimeConfig,
  type PostHogRuntimeConfigObj,
} from "@/shared/backend/config/posthog.config";
import { censorLogValue } from "@/shared/backend/logging/censorship";
import { temporalInstantToDate } from "@/shared/utils/temporal";

export type PostHogEventProperties = NonNullable<EventMessage["properties"]>;

export interface CapturePostHogEventInput {
  readonly distinctId: PostHogDistinctId;
  readonly event: string;
  readonly properties?: PostHogEventProperties;
  readonly timestamp: Temporal.Instant;
  readonly uuid: PostHogEventId;
}

export interface IPostHogEventService {
  readonly capture: (input: CapturePostHogEventInput) => Effect.Effect<void>;
}

interface PostHogCaptureClient {
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
  static Live = Layer.effect(
    this,
    Effect.gen(function* () {
      const config = yield* PostHogRuntimeConfig;
      return makePostHogEventService({
        client: createPostHogCaptureClient(config),
        config,
      });
    })
  );

  static LiveWithDependencies = this.Live.pipe(
    Layer.provide(PostHogRuntimeConfig.Live)
  );
}

const createPostHogCaptureClient = ({
  host,
  projectToken,
}: PostHogRuntimeConfigObj): PostHogCaptureClient | undefined => {
  if (!projectToken) return undefined;
  return new PostHog(projectToken, { host });
};

const collectContextProperties = Effect.gen(function* () {
  const logAnnotations = yield* References.CurrentLogAnnotations;
  const spanAnnotations = yield* Effect.spanAnnotations;

  const currentSpan = yield* Effect.currentSpan.pipe(Effect.option);
  const spanMetadata = Option.isSome(currentSpan)
    ? {
        "effect.span_id": currentSpan.value.spanId,
        "effect.span_name": currentSpan.value.name,
        "effect.trace_id": currentSpan.value.traceId,
      }
    : {};

  return {
    properties: {
      ...logAnnotations,
      effect: {
        spanAnnotations,
        spanAttributes: Option.isSome(currentSpan)
          ? Object.fromEntries(currentSpan.value.attributes)
          : undefined,
      },
    },
    spanMetadata,
  };
});

const compactProperties = (properties: PostHogEventProperties) =>
  Object.fromEntries(
    Object.entries(properties).filter(([, value]) => value !== undefined)
  ) as PostHogEventProperties;

export const makePostHogEventService = ({
  client,
  config,
}: PostHogEventServiceOptions): IPostHogEventService => ({
  capture: (input) =>
    Effect.gen(function* () {
      if (!client) return;

      const contextProperties = yield* collectContextProperties;
      const censoredProperties = compactProperties(
        censorLogValue({
          ...contextProperties.properties,
          ...input.properties,
        }) as PostHogEventProperties
      );
      const properties = compactProperties({
        ...censoredProperties,
        ...contextProperties.spanMetadata,
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
});
