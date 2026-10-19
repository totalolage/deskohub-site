import "server-only";

import {
  PostHogDistinctId,
  PostHogEventId,
} from "@deskohub/posthog/identifiers";
import { Effect } from "effect";
import {
  type AgentTraffic,
  agentTrafficProperties,
} from "@/shared/agent-traffic/agent-traffic";
import {
  type PostHogEventProperties,
  PostHogEventService,
} from "@/shared/backend/analytics/posthog-event.service";
import {
  runWorkspaceEffect,
  runWorkspaceEffectAfterResponse,
} from "@/shared/backend/workspace-effect";

export interface AgentTrafficEvent {
  readonly event:
    | "agent page request"
    | "agent tool call"
    | "bot protection rejection";
  readonly traffic: AgentTraffic;
  /** Low-cardinality context; never a user agent, header value, or IP. */
  readonly properties: PostHogEventProperties;
  readonly timestamp: Temporal.Instant;
}

/**
 * Captures an agent traffic event without any person: every event gets its
 * own random distinct ID and creates no person profile, whatever the
 * client's analytics consent.
 */
export const captureAgentTrafficEvent = Effect.fn("agentTraffic.captureEvent")(
  function* (input: AgentTrafficEvent) {
    const posthog = yield* PostHogEventService;
    const { distinctId, uuid } = yield* Effect.sync(() => ({
      distinctId: PostHogDistinctId.make(crypto.randomUUID()),
      uuid: PostHogEventId.make(crypto.randomUUID()),
    }));
    yield* posthog.capture({
      distinctId,
      event: input.event,
      properties: {
        ...input.properties,
        ...agentTrafficProperties(input.traffic),
        $process_person_profile: false,
      },
      timestamp: input.timestamp,
      uuid,
    });
  }
);

const captureLiveAgentTrafficEvent = (input: AgentTrafficEvent) =>
  captureAgentTrafficEvent(input).pipe(
    Effect.provide(PostHogEventService.Live)
  );

/** Records the event after the current response is sent. */
export const scheduleAgentTrafficEvent = (input: AgentTrafficEvent) =>
  runWorkspaceEffectAfterResponse(
    "agent-traffic.capture",
    captureLiveAgentTrafficEvent(input)
  );

/** Records the event now; for the proxy's own after-response callback. */
export const recordAgentTrafficEvent = (input: AgentTrafficEvent) =>
  captureLiveAgentTrafficEvent(input).pipe(
    runWorkspaceEffect("agent-traffic.capture")
  );
