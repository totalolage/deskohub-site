import "@/shared/testing/workspace-test-env";

import { expect, test } from "bun:test";
import { Effect, Layer } from "effect";
import {
  type CapturePostHogEventInput,
  PostHogEventService,
} from "@/shared/backend/analytics/posthog-event.service";
import { captureAgentTrafficEvent } from "./agent-traffic-events";

const captureEvents = async (count: number) => {
  const captures: CapturePostHogEventInput[] = [];
  const timestamp = Temporal.Instant.from("2099-06-17T12:00:00.000Z");
  await Effect.runPromise(
    Effect.forEach(Array.from({ length: count }), () =>
      captureAgentTrafficEvent({
        event: "agent page request",
        traffic: { category: "ai_user_agent", name: "claude" },
        properties: { route: "/reservation/cowork", locale: "en-US" },
        timestamp,
      })
    ).pipe(
      Effect.provide(
        Layer.succeed(PostHogEventService, {
          alias: () => Effect.die("agent traffic never aliases"),
          capture: (input) => Effect.sync(() => captures.push(input)),
        })
      )
    )
  );
  return { captures, timestamp };
};

test("captures agent traffic without a person", async () => {
  const { captures, timestamp } = await captureEvents(2);

  expect(captures).toHaveLength(2);
  expect(captures[0]).toMatchObject({
    event: "agent page request",
    properties: {
      route: "/reservation/cowork",
      locale: "en-US",
      agent_category: "ai_user_agent",
      agent_name: "claude",
      $process_person_profile: false,
    },
    timestamp,
  });
  expect(captures[0].properties).not.toHaveProperty("$session_id");
  // Each event stands alone: no shared distinct ID links two requests.
  expect(captures[0].distinctId).not.toBe(captures[1].distinctId);
  expect(captures[0].uuid).not.toBe(captures[1].uuid);
});
