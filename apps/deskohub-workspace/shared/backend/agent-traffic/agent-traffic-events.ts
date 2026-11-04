import "server-only";

import { Context, Effect, Layer } from "effect";
import type { AgentTraffic } from "@/shared/agent-traffic/agent-traffic";
import {
  ServerAnalytics,
  type ServerEventProperties,
} from "@/shared/backend/analytics/server-analytics.service";
import {
  defineWorkspaceTask,
  runWorkspaceEffectAfterResponse,
} from "@/shared/backend/workspace-effect";

export interface AgentTrafficEvent {
  readonly event:
    | "agent page request"
    | "agent tool call"
    | "bot protection rejection";
  readonly traffic: AgentTraffic;
  /** Low-cardinality context; never a user agent, header value, or IP. */
  readonly properties: ServerEventProperties;
  readonly timestamp: Temporal.Instant;
}

/**
 * Agent traffic events, captured without any person: every event gets its
 * own random distinct ID and creates no person profile, whatever the
 * client's analytics consent.
 */
export class AgentTrafficEvents extends Context.Service<
  AgentTrafficEvents,
  { readonly record: (event: AgentTrafficEvent) => Effect.Effect<void> }
>()("@deskohub-workspace/agent-traffic/AgentTrafficEvents") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const analytics = yield* ServerAnalytics;
      return {
        record: ({ event, traffic, properties, timestamp }) =>
          analytics.capture({
            name: event,
            subject: { kind: "anonymous", traffic },
            properties,
            timestamp,
          }),
      };
    })
  );

  static Live = this.Default.pipe(Layer.provide(ServerAnalytics.Live));
}

/**
 * Records the event. This work runs after the response, so its run sends the
 * event before it settles.
 */
const recordAfterResponse = (input: AgentTrafficEvent) =>
  Effect.flatMap(AgentTrafficEvents, (events) => events.record(input)).pipe(
    Effect.provide(AgentTrafficEvents.Live)
  );

/** Records the event after the current response is sent. */
export const scheduleAgentTrafficEvent = (input: AgentTrafficEvent) =>
  runWorkspaceEffectAfterResponse(
    "agent-traffic.capture",
    recordAfterResponse(input)
  );

/**
 * Records the event now and sends it before settling; for the proxy's own
 * after-response callback, which no response follows.
 */
export const recordAgentTrafficEvent = defineWorkspaceTask(
  "agent-traffic.capture",
  recordAfterResponse
);
