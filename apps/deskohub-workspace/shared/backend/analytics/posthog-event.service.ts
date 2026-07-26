import "server-only";

import { Context, Effect, Layer, Option, References } from "effect";
import { type EventMessage, PostHog } from "posthog-node";
import {
  PostHogRuntimeConfig,
  PostHogRuntimeConfigLive,
  type PostHogRuntimeConfigObj,
} from "@/shared/backend/config/posthog.config";
import { censorLogValue } from "@/shared/backend/logging/censorship";
import {
  WORKSPACE_SERVICE_NAME,
  WORKSPACE_SERVICE_NAMESPACE,
} from "@/shared/backend/observability/workspace-service";
import { temporalInstantToDate } from "@/shared/utils/temporal";

export type PostHogEventProperties = NonNullable<EventMessage["properties"]>;

export interface CapturePostHogEventInput {
  readonly distinctId: string;
  readonly event: string;
  readonly properties?: PostHogEventProperties;
  readonly timestamp: Temporal.Instant;
  readonly uuid: string;
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
}

export const PostHogEventServiceLive = PostHogEventService.Live.pipe(
  Layer.provide(PostHogRuntimeConfigLive)
);

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
  return {
    ...logAnnotations,
    ...spanAnnotations,
    ...(Option.isSome(currentSpan)
      ? {
          ...Object.fromEntries(currentSpan.value.attributes),
          operation: currentSpan.value.name,
        }
      : {}),
  };
});

const compactProperties = (properties: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(properties).filter(([, value]) => value !== undefined)
  ) as PostHogEventProperties;

const lifecycleEventNames = new Set([
  "payment abandoned",
  "payment completed",
  "payment failed",
  "payment started",
  "reservation abandoned",
  "reservation completed",
  "reservation fulfilled",
  "reservation started",
]);

const projectLifecycleEventName = (event: string) =>
  lifecycleEventNames.has(event) ? event : "workspace lifecycle";

const projectDeploymentEnvironment = (environment: string) =>
  environment === "development" ||
  environment === "preview" ||
  environment === "production"
    ? environment
    : undefined;

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
          ...contextProperties,
          ...input.properties,
        }) as Record<string, unknown>
      );
      const properties = compactProperties({
        ...censoredProperties,
        "deployment.environment.name": projectDeploymentEnvironment(
          config.environment
        ),
        "service.name": WORKSPACE_SERVICE_NAME,
        "service.namespace": WORKSPACE_SERVICE_NAMESPACE,
      });

      yield* Effect.tryPromise(() =>
        client.captureImmediate({
          distinctId: "deskohub-workspace:lifecycle",
          event: projectLifecycleEventName(input.event),
          properties,
          timestamp: temporalInstantToDate(input.timestamp),
          uuid: crypto.randomUUID(),
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
