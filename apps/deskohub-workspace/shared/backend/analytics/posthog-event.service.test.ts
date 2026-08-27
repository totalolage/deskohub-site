import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import {
  PostHogDistinctId,
  PostHogEventId,
} from "@deskohub/posthog/identifiers";
import { Effect } from "effect";
import type { EventMessage } from "posthog-node";

const config = {
  environment: "development",
  ingestHost: "https://posthog.example",
  projectToken: "phc_test",
  serviceName: "workspace-test",
  serviceNamespace: "deskohub-test",
};

const reservationDistinctId = PostHogDistinctId.make("reservation-id");
const eventId = PostHogEventId.make("019edbcf-5026-7ecc-821b-eda46998eaaa");

describe("PostHogEventService", () => {
  test("captures only explicit scalar properties and approved metadata", async () => {
    const { makePostHogEventService } = await import("./posthog-event.service");
    const messages: EventMessage[] = [];
    const service = makePostHogEventService({
      client: {
        aliasImmediate: () => Promise.resolve(),
        captureImmediate: (message) => {
          messages.push(message);
          return Promise.resolve();
        },
      },
      config,
    });

    await Effect.runPromise(
      service
        .capture({
          distinctId: reservationDistinctId,
          event: "reservation started",
          properties: {
            providerPayload: { raw: "provider-data" },
            reservation_id: "reservation-id",
          } as never,
          timestamp: Temporal.Instant.from("2026-06-17T10:00:00.000Z"),
          uuid: eventId,
        })
        .pipe(
          Effect.annotateLogs({
            correlationId: "correlation-id",
            customerInput: { email: "synthetic@example.test" },
            error: new Error("provider payload"),
            result: { internal: "serialized-result" },
            sessionId: "session-id",
          }),
          Effect.annotateSpans({
            providerPayload: "provider-payload",
          }),
          Effect.withSpan("reservation.attachHold", {
            attributes: {
              paymentAttemptId: "payment-attempt-id",
              secret: "span-secret",
            },
          })
        )
    );

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      distinctId: "reservation-id",
      event: "reservation started",
      timestamp: new Date("2026-06-17T10:00:00.000Z"),
      uuid: "019edbcf-5026-7ecc-821b-eda46998eaaa",
    });
    expect(messages[0].properties).toEqual({
      "deployment.environment.name": "development",
      "effect.span_id": expect.any(String),
      "effect.trace_id": expect.any(String),
      "service.name": "workspace-test",
      "service.namespace": "deskohub-test",
      reservation_id: "reservation-id",
    });
  });

  test("aliases a browser identity to a server identity", async () => {
    const { makePostHogEventService } = await import("./posthog-event.service");
    const aliases: { alias: string; distinctId: string }[] = [];
    const service = makePostHogEventService({
      client: {
        aliasImmediate: (message) => {
          aliases.push(message);
          return Promise.resolve();
        },
        captureImmediate: () => Promise.resolve(),
      },
      config,
    });

    await Effect.runPromise(
      service.alias({
        distinctId: PostHogDistinctId.make("synthetic-browser-id"),
        alias: reservationDistinctId,
      })
    );

    expect(aliases).toEqual([
      {
        alias: "reservation-id",
        distinctId: "synthetic-browser-id",
      },
    ]);
  });

  test("does nothing without a configured client", async () => {
    const { makePostHogEventService } = await import("./posthog-event.service");
    const service = makePostHogEventService({ config });

    await Effect.runPromise(
      service.capture({
        distinctId: reservationDistinctId,
        event: "reservation started",
        timestamp: Temporal.Instant.from("2026-06-17T10:00:00.000Z"),
        uuid: eventId,
      })
    );
  });
});
