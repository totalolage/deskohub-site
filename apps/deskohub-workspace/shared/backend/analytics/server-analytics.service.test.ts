import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { Effect, Layer } from "effect";
import { PostHog } from "posthog-node";
import { customerAccountIdSchema } from "@/features/account/customer-account";
import { unclassifiedTraffic } from "@/shared/agent-traffic/agent-traffic";
import { PostHogRuntimeConfig } from "@/shared/backend/config/posthog.config";
import { withWorkspaceRequestContext } from "@/shared/backend/workspace-request-context";
import { savedConsentCookieValue } from "@/shared/testing/consent-cookie.test-utils";
import {
  POSTHOG_DISTINCT_ID_COOKIE,
  POSTHOG_SESSION_ID_COOKIE,
} from "@/shared/utils/posthog-session-cookies";
import type { ServerEvent } from "./server-analytics.service";

const { AnalyticsEventDelivery, makePostHogEventDelivery } = await import(
  "./analytics-event-delivery.service"
);
const { ServerAnalytics } = await import("./server-analytics.service");
const { recordServerAnalytics, serverAnalyticsTestConfig } = await import(
  "./server-analytics.service.mock"
);

const timestamp = Temporal.Instant.from("2026-06-17T10:00:00.000Z");

const consentedVisitorHeaders = new Headers({
  cookie: `cc_cookie=${savedConsentCookieValue({ categories: ["necessary", "analytics"] })}; ${POSTHOG_DISTINCT_ID_COOKIE}=synthetic-browser-id; ${POSTHOG_SESSION_ID_COOKIE}=synthetic-session-id`,
});

const captureAll = (
  events: readonly ServerEvent[],
  context: <A>(effect: Effect.Effect<A>) => Effect.Effect<A> = (effect) =>
    effect
) => {
  const recorder = recordServerAnalytics();
  return Effect.forEach(events, (event) =>
    Effect.flatMap(ServerAnalytics, (analytics) => analytics.capture(event))
  ).pipe(Effect.provide(recorder.layer), context, Effect.runPromise, (run) =>
    run.then(() => recorder.messages)
  );
};

describe("ServerAnalytics", () => {
  test("sends only explicit scalar properties and approved metadata", async () => {
    const recorder = recordServerAnalytics();

    await Effect.runPromise(
      Effect.flatMap(ServerAnalytics, (analytics) =>
        analytics.capture({
          name: "reservation started",
          subject: {
            kind: "record",
            recordId: "reservation-id",
            occurrenceId: "reservation-id",
          },
          properties: {
            providerPayload: { raw: "provider-data" },
            reservation_id: "reservation-id",
            unset: undefined,
          } as never,
          timestamp,
        })
      ).pipe(
        Effect.provide(recorder.layer),
        Effect.annotateLogs({
          correlationId: "correlation-id",
          customerInput: { email: testEmailAddress("synthetic") },
          error: new Error("provider payload"),
          result: { internal: "serialized-result" },
          sessionId: "session-id",
        }),
        Effect.annotateSpans({ providerPayload: "provider-payload" }),
        Effect.withSpan("reservation.attachHold", {
          attributes: {
            paymentAttemptId: "payment-attempt-id",
            secret: "span-secret",
          },
        })
      )
    );

    expect(recorder.messages).toEqual([
      {
        distinctId: "reservation-id",
        event: "reservation started",
        properties: {
          $process_person_profile: false,
          agent_category: "unclassified",
          "deployment.environment.name": "development",
          "effect.span_id": expect.any(String),
          "effect.trace_id": expect.any(String),
          reservation_id: "reservation-id",
          "service.name": "workspace-test",
          "service.namespace": "deskohub-test",
        },
        timestamp,
        uuid: "reservation-id:reservation started",
      },
    ]);
  });

  test("keeps a record's events off the consented visitor", async () => {
    const messages = await captureAll(
      [
        {
          name: "payment started",
          subject: {
            kind: "record",
            recordId: "reservation-id",
            occurrenceId: "payment-attempt-id",
          },
          properties: {},
          timestamp,
        },
      ],
      withWorkspaceRequestContext(consentedVisitorHeaders, unclassifiedTraffic)
    );

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      distinctId: "reservation-id",
      uuid: "payment-attempt-id:payment started",
    });
    expect(messages[0]?.properties).not.toHaveProperty("$session_id");
    expect(Object.values(messages[0]?.properties ?? {})).not.toContain(
      "synthetic-browser-id"
    );
  });

  test("sends an account's event under its person, without the visitor or session", async () => {
    const messages = await captureAll(
      [
        {
          name: "payment started",
          subject: {
            kind: "account",
            accountId: customerAccountIdSchema.make("account-a"),
            occurrenceId: "payment-attempt-id",
          },
          properties: { reservation_id: "reservation-id" },
          timestamp,
        },
      ],
      withWorkspaceRequestContext(consentedVisitorHeaders, unclassifiedTraffic)
    );

    expect(messages).toEqual([
      {
        distinctId: "workspace-account:account-a",
        event: "payment started",
        // Person processing stays on: no `$process_person_profile`.
        properties: {
          agent_category: "unclassified",
          "deployment.environment.name": "development",
          "effect.span_id": expect.any(String),
          "effect.trace_id": expect.any(String),
          reservation_id: "reservation-id",
          "service.name": "workspace-test",
          "service.namespace": "deskohub-test",
        },
        timestamp,
        uuid: "payment-attempt-id:payment started",
      },
    ]);
  });

  test("sends a visitor's event under the consented visitor and session", async () => {
    const visitorEvent: ServerEvent = {
      name: "availability result",
      subject: {
        kind: "visitor",
        occurrenceId: "checkout-attempt-id",
        result: "available",
      },
      properties: { result: "available" },
      timestamp,
    };

    const consented = await captureAll(
      [visitorEvent],
      withWorkspaceRequestContext(consentedVisitorHeaders, unclassifiedTraffic)
    );
    const withoutRequest = await captureAll([visitorEvent]);

    expect(consented).toHaveLength(1);
    expect(consented[0]).toMatchObject({
      distinctId: "synthetic-browser-id",
      properties: {
        $process_person_profile: false,
        $session_id: "synthetic-session-id",
        result: "available",
      },
      uuid: "checkout-attempt-id:availability result:available",
    });
    expect(withoutRequest).toEqual([]);
  });

  test("links no two anonymous events, even in a consented visitor's request", async () => {
    const anonymousEvent: ServerEvent = {
      name: "agent tool call",
      subject: {
        kind: "anonymous",
        traffic: { category: "ai_user_agent", name: "claude" },
      },
      properties: { tool: "book" },
      timestamp,
    };

    const messages = await captureAll(
      [anonymousEvent, anonymousEvent],
      withWorkspaceRequestContext(consentedVisitorHeaders, unclassifiedTraffic)
    );

    expect(messages).toHaveLength(2);
    expect(messages[0]?.properties).toMatchObject({
      $process_person_profile: false,
      agent_category: "ai_user_agent",
      agent_name: "claude",
      tool: "book",
    });
    expect(messages[0]?.properties).not.toHaveProperty("$session_id");
    expect(messages[0]?.distinctId).not.toBe("synthetic-browser-id");
    expect(messages[0]?.distinctId).not.toBe(messages[1]?.distinctId);
    expect(messages[0]?.uuid).not.toBe(messages[1]?.uuid);
  });

  test("never fails the work that captures", async () => {
    const layer = ServerAnalytics.Default.pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.succeed(AnalyticsEventDelivery, {
            send: () => Effect.die(new Error("synthetic delivery defect")),
          }),
          Layer.succeed(PostHogRuntimeConfig, serverAnalyticsTestConfig)
        )
      )
    );

    const exit = await Effect.runPromiseExit(
      Effect.flatMap(ServerAnalytics, (analytics) =>
        analytics.capture({
          name: "payment completed",
          subject: {
            kind: "record",
            recordId: "reservation-id",
            occurrenceId: "payment-attempt-id",
          },
          properties: {},
          timestamp,
        })
      ).pipe(Effect.provide(layer))
    );

    expect(exit._tag).toBe("Success");
  });
});

describe("PostHog event delivery", () => {
  test("sends the event the history reads, with no person profile or GeoIP", async () => {
    const requests: {
      url: string;
      body: { batch: { properties: object; uuid: string }[] };
    }[] = [];
    const client = new PostHog("phc_synthetic", {
      host: "https://ingest.posthog.example",
      disableCompression: true,
      fetch: async (url, options) => {
        requests.push({
          url: String(url),
          body: JSON.parse(String(options?.body)),
        });
        return new Response("{}", { status: 200 });
      },
    });
    const layer = ServerAnalytics.Default.pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.succeed(
            AnalyticsEventDelivery,
            makePostHogEventDelivery(client)
          ),
          Layer.succeed(PostHogRuntimeConfig, serverAnalyticsTestConfig)
        )
      )
    );

    await Effect.runPromise(
      Effect.flatMap(ServerAnalytics, (analytics) =>
        analytics.capture({
          name: "payment completed",
          subject: {
            kind: "record",
            recordId: "reservation-id",
            occurrenceId: "payment-attempt-id",
          },
          properties: { reservation_id: "reservation-id", revenue: 350 },
          timestamp,
        })
      ).pipe(Effect.provide(layer))
    );
    // Queued, not sent, until a flush.
    expect(requests).toEqual([]);
    await client.flush();
    await client.shutdown();

    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe("https://ingest.posthog.example/batch/");
    expect(requests[0]?.body).toMatchObject({
      api_key: "phc_synthetic",
      batch: [
        {
          distinct_id: "reservation-id",
          event: "payment completed",
          timestamp: "2026-06-17T10:00:00.000Z",
          properties: {
            $geoip_disable: true,
            $lib: "posthog-node",
            $process_person_profile: false,
            agent_category: "unclassified",
            "deployment.environment.name": "development",
            reservation_id: "reservation-id",
            revenue: 350,
            "service.name": "workspace-test",
            "service.namespace": "deskohub-test",
          },
        },
      ],
    });
    const sent = requests[0]?.body.batch[0];
    expect(Object.keys(sent?.properties ?? {})).not.toContain("$set");
    // The SDK sends a random UUIDv7 in place of an event UUID that isn't a
    // UUID, such as `<attempt>:<event>`, so PostHog doesn't deduplicate a
    // repeated capture by it.
    expect(sent?.uuid).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
  });
});
