import "@/shared/testing/workspace-test-env";

import { expect, test } from "bun:test";
import { Effect, Layer } from "effect";
import { recordServerAnalytics } from "@/shared/backend/analytics/server-analytics.service.mock";
import { AgentTrafficEvents } from "./agent-traffic-events";

test("captures agent traffic without a person", async () => {
  const recorder = recordServerAnalytics();
  const timestamp = Temporal.Instant.from("2099-06-17T12:00:00.000Z");
  const event = {
    event: "agent page request",
    traffic: { category: "ai_user_agent", name: "claude" },
    properties: { route: "/reservation/cowork", locale: "en-US" },
    timestamp,
  } as const;

  await Effect.runPromise(
    Effect.flatMap(AgentTrafficEvents, (events) =>
      Effect.all([events.record(event), events.record(event)])
    ).pipe(
      Effect.provide(
        AgentTrafficEvents.Default.pipe(Layer.provide(recorder.layer))
      )
    )
  );

  const [first, second] = recorder.messages;
  expect(recorder.messages).toHaveLength(2);
  expect(first).toMatchObject({
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
  expect(first?.properties).not.toHaveProperty("$session_id");
  // Each event stands alone: no shared distinct ID links two requests.
  expect(first?.distinctId).not.toBe(second?.distinctId);
  expect(first?.uuid).not.toBe(second?.uuid);
});
