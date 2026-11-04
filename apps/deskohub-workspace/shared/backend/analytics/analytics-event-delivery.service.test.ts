import { afterEach, describe, expect, mock, test } from "bun:test";
import type {
  PostHogDistinctId,
  PostHogEventId,
} from "@deskohub/posthog/identifiers";
import { Effect } from "effect";
import type { PostHog } from "posthog-node";
import type { PostHogRuntimeConfigObj } from "@/shared/backend/config/posthog.config";

mock.module("server-only", () => ({}));

// No event reaches PostHog: the SDK client is a fake that records what the
// delivery hands it.
type PostHogOptions = ConstructorParameters<typeof PostHog>[1];
type CapturedEvent = Parameters<PostHog["capture"]>[0];
const constructedClients: {
  readonly projectToken: string;
  readonly options: PostHogOptions;
}[] = [];
const capturedEvents: CapturedEvent[] = [];
class FakePostHog {
  constructor(projectToken: string, options: PostHogOptions) {
    constructedClients.push({ projectToken, options });
  }
  capture(event: CapturedEvent) {
    capturedEvents.push(event);
  }
  on() {
    return this;
  }
}
const posthogNode = await import("posthog-node");
mock.module("posthog-node", () => ({ ...posthogNode, PostHog: FakePostHog }));

const postHogConfig = await import("@/shared/backend/config/posthog.config");
const runtimeConfig: PostHogRuntimeConfigObj = {
  ...postHogConfig.postHogRuntimeConfig,
  ingestHost: "https://ingest.posthog.example",
  projectToken: undefined,
};
mock.module("@/shared/backend/config/posthog.config", () => ({
  ...postHogConfig,
  postHogRuntimeConfig: runtimeConfig,
}));

const { AnalyticsEventDelivery } = await import(
  "./analytics-event-delivery.service"
);

const captureClientKey = Symbol.for(
  "@deskohub-workspace/analytics/capture-client"
);

const message = {
  distinctId: "synthetic-visitor" as PostHogDistinctId,
  event: "synthetic event",
  properties: { source: "test" },
  timestamp: Temporal.Instant.from("2026-06-01T10:00:00Z"),
  uuid: "synthetic-event-id" as PostHogEventId,
};

const sendThroughDefaultDelivery = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const delivery = yield* AnalyticsEventDelivery;
      yield* delivery.send(message);
    }).pipe(Effect.provide(AnalyticsEventDelivery.Default))
  );

afterEach(() => {
  Reflect.deleteProperty(globalThis, captureClientKey);
  constructedClients.length = 0;
  capturedEvents.length = 0;
  Object.assign(runtimeConfig, { projectToken: undefined });
});

describe("AnalyticsEventDelivery.Default", () => {
  test("drops events without a PostHog project", async () => {
    await sendThroughDefaultDelivery();

    expect(constructedClients).toEqual([]);
    expect(capturedEvents).toEqual([]);
  });

  test("queues every event on one capture client for the process", async () => {
    Object.assign(runtimeConfig, { projectToken: "synthetic-project-token" });

    await sendThroughDefaultDelivery();
    await sendThroughDefaultDelivery();

    expect(constructedClients).toEqual([
      {
        projectToken: "synthetic-project-token",
        options: expect.objectContaining({
          host: "https://ingest.posthog.example",
        }),
      },
    ]);
    expect(capturedEvents).toHaveLength(2);
    expect(capturedEvents[0]).toMatchObject({
      distinctId: message.distinctId,
      event: message.event,
      uuid: message.uuid,
    });
  });
});
