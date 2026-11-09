import "server-only";

import {
  PostHogDistinctId,
  PostHogEventId,
} from "@deskohub/posthog/identifiers";
import { Context, Effect, Layer, Option, Predicate } from "effect";
import type { CustomerAccountId } from "@/features/account/customer-account";
import { getPostHogAccountDistinctId } from "@/features/account/posthog-account-distinct-id";
import {
  type AgentTraffic,
  agentTrafficProperties,
} from "@/shared/agent-traffic/agent-traffic";
import { PostHogRuntimeConfig } from "@/shared/backend/config/posthog.config";
import { collectSpanMetadata } from "@/shared/backend/observability/trace-correlation";
import {
  CurrentAgentTraffic,
  currentVisitorIdentity,
} from "@/shared/backend/workspace-request-context";
import {
  AnalyticsEventDelivery,
  type AnalyticsEventMessage,
} from "./analytics-event-delivery.service";
import { anonymousVisitor } from "./visitor-identity";

type ServerEventProperty = string | number | boolean | null;

/** An event's own properties; undefined values are not sent. */
export type ServerEventProperties = Readonly<
  Record<string, ServerEventProperty | undefined>
>;

/**
 * Whom a server event is about. The subject decides the event's distinct ID,
 * its UUID, the request context it carries, and whether PostHog processes a
 * person for it: only an account's events do.
 */
type ServerEventSubject =
  /**
   * A Workspace record, the distinct ID of all its events. Each event happens
   * once per `occurrenceId`: the record itself or one of its parts, so a
   * repeated capture deduplicates in PostHog. Carries the request's agent
   * traffic, whatever the visitor's consent.
   */
  | {
      readonly kind: "record";
      readonly recordId: string;
      readonly occurrenceId: string;
    }
  /**
   * A customer account's person, the distinct ID the browser identifies the
   * signed-in account as, for an event the account's analytics consent links
   * to it. Each event happens once per `occurrenceId`, as for a record. Carries
   * the request's agent traffic but never the visitor's session, since the
   * event may be captured outside the account's own request.
   */
  | {
      readonly kind: "account";
      readonly accountId: CustomerAccountId;
      readonly occurrenceId: string;
    }
  /**
   * The consented visitor of the request being served, with its session.
   * Without one, such as without analytics consent or outside a request, the
   * event isn't sent. Each event happens once per `occurrenceId` and `result`.
   */
  | {
      readonly kind: "visitor";
      readonly occurrenceId: string;
      readonly result: string;
    }
  /**
   * No one: a random distinct ID and UUID per event, so no two events link.
   * Carries the given agent traffic.
   */
  | { readonly kind: "anonymous"; readonly traffic: AgentTraffic };

export interface ServerEvent {
  readonly name: string;
  readonly subject: ServerEventSubject;
  readonly properties: ServerEventProperties;
  readonly timestamp: Temporal.Instant;
}

export interface IServerAnalytics {
  /**
   * Sends `event` under its subject's identity policy, with the deployment,
   * service, and trace fields. Best effort: never fails, and never waits for
   * PostHog.
   */
  readonly capture: (event: ServerEvent) => Effect.Effect<void>;
}

/**
 * The server's analytics capture. Feature modules wrap it in typed domain
 * operations, so a caller can't pass another identifier through; don't call
 * it from outside one.
 */
export class ServerAnalytics extends Context.Service<
  ServerAnalytics,
  IServerAnalytics
>()("@deskohub-workspace/analytics/ServerAnalytics") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const config = yield* PostHogRuntimeConfig;
      const delivery = yield* AnalyticsEventDelivery;

      const capture = Effect.fn("ServerAnalytics.capture")(
        function* (event: ServerEvent) {
          const addressed = yield* addressEvent(event);
          if (Option.isNone(addressed)) return;

          const spanMetadata = yield* collectSpanMetadata;
          yield* delivery.send({
            ...addressed.value,
            properties: sentProperties({
              ...addressed.value.properties,
              ...spanMetadata,
              "deployment.environment.name": config.environment,
              "service.name": config.serviceName,
              "service.namespace": config.serviceNamespace,
            }),
          });
        },
        // Payment, webhook, and fulfillment work captures on its way: a
        // defect here must not fail it.
        (effect, event) =>
          Effect.catchDefect(effect, (cause) =>
            Effect.logWarning("Server analytics event not captured", {
              event: event.name,
              cause,
            })
          )
      );

      return { capture };
    })
  );

  static Live = this.Default.pipe(
    Layer.provide(
      Layer.mergeAll(
        AnalyticsEventDelivery.Default,
        PostHogRuntimeConfig.Default
      )
    )
  );
}

type AddressedEvent = Omit<AnalyticsEventMessage, "properties"> & {
  readonly properties: ServerEventProperties;
};

/** The event's identity and context under its subject's policy. */
const addressEvent = (
  event: ServerEvent
): Effect.Effect<Option.Option<AddressedEvent>> => {
  const { subject } = event;
  switch (subject.kind) {
    case "record":
      return Effect.map(CurrentAgentTraffic, (traffic) =>
        Option.some({
          distinctId: PostHogDistinctId.make(subject.recordId),
          event: event.name,
          properties: {
            ...event.properties,
            ...agentTrafficProperties(traffic),
            $process_person_profile: false,
          },
          timestamp: event.timestamp,
          uuid: PostHogEventId.make(`${subject.occurrenceId}:${event.name}`),
        })
      );
    case "account":
      return Effect.map(CurrentAgentTraffic, (traffic) =>
        Option.some({
          distinctId: getPostHogAccountDistinctId(subject.accountId),
          event: event.name,
          properties: {
            ...event.properties,
            ...agentTrafficProperties(traffic),
          },
          timestamp: event.timestamp,
          uuid: PostHogEventId.make(`${subject.occurrenceId}:${event.name}`),
        })
      );
    case "visitor":
      return Effect.gen(function* () {
        // Work outside any request serves no visitor.
        const { distinctId, sessionId } = yield* currentVisitorIdentity.pipe(
          Effect.orElseSucceed(() => anonymousVisitor)
        );
        if (!distinctId) return Option.none();

        const traffic = yield* CurrentAgentTraffic;
        return Option.some({
          distinctId,
          event: event.name,
          properties: {
            ...event.properties,
            ...agentTrafficProperties(traffic),
            $process_person_profile: false,
            ...(sessionId !== undefined && { $session_id: sessionId }),
          },
          timestamp: event.timestamp,
          uuid: PostHogEventId.make(
            `${subject.occurrenceId}:${event.name}:${subject.result}`
          ),
        });
      });
    case "anonymous":
      return Effect.sync(() =>
        Option.some({
          distinctId: PostHogDistinctId.make(crypto.randomUUID()),
          event: event.name,
          properties: {
            ...event.properties,
            ...agentTrafficProperties(subject.traffic),
            $process_person_profile: false,
          },
          timestamp: event.timestamp,
          uuid: PostHogEventId.make(crypto.randomUUID()),
        })
      );
  }
};

/** Only scalar values are sent; anything else, undefined included, is not. */
const sentProperties = (properties: ServerEventProperties) =>
  Object.fromEntries(
    Object.entries(properties).filter(
      ([, value]) =>
        value === null ||
        Predicate.isString(value) ||
        Predicate.isNumber(value) ||
        Predicate.isBoolean(value)
    )
  ) as AnalyticsEventMessage["properties"];
