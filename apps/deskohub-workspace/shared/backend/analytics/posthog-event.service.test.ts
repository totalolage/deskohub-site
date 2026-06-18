import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import type { EventMessage } from "posthog-node";
import { CENSORED_LOG_VALUE } from "@/shared/backend/logging/censorship";

const config = {
  environment: "development",
  host: "https://posthog.example",
  projectToken: "phc_test",
  serviceName: "workspace-test",
  serviceNamespace: "deskohub-test",
};

describe("PostHogEventService", () => {
  test("captures lifecycle events with censored Effect context", async () => {
    const { makePostHogEventService } = await import("./posthog-event.service");
    const messages: EventMessage[] = [];
    const service = makePostHogEventService({
      client: {
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
          distinctId: "reservation-id",
          event: "reservation started",
          properties: {
            reservation_id: "reservation-id",
            token: "explicit-secret",
          },
          timestamp: new Date("2026-06-17T10:00:00.000Z"),
          uuid: "019edbcf-5026-7ecc-821b-eda46998eaaa",
        })
        .pipe(
          Effect.annotateLogs({
            correlationId: "correlation-id",
            sessionId: "session-id",
            token: "annotation-secret",
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
    expect(messages[0].properties).toMatchObject({
      "deployment.environment.name": "development",
      "effect.span_name": "reservation.attachHold",
      "service.name": "workspace-test",
      "service.namespace": "deskohub-test",
      correlationId: "correlation-id",
      reservation_id: "reservation-id",
      sessionId: "session-id",
      token: CENSORED_LOG_VALUE,
    });
    expect(messages[0].properties?.effect).toMatchObject({
      spanAttributes: {
        paymentAttemptId: "payment-attempt-id",
        secret: CENSORED_LOG_VALUE,
      },
    });
  });

  test("does nothing without a configured client", async () => {
    const { makePostHogEventService } = await import("./posthog-event.service");
    const service = makePostHogEventService({ config });

    await Effect.runPromise(
      service.capture({
        distinctId: "reservation-id",
        event: "reservation started",
        timestamp: new Date("2026-06-17T10:00:00.000Z"),
        uuid: "019edbcf-5026-7ecc-821b-eda46998eaaa",
      })
    );
  });
});
