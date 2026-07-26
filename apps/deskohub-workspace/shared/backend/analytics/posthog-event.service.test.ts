import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import type { EventMessage } from "posthog-node";
import { CENSORED_LOG_VALUE } from "@/shared/backend/logging/censorship";

const config = {
  environment: "development",
  host: "https://posthog.example",
  projectToken: "phc_test",
  serviceName: "SyntheticValidServiceName",
  serviceNamespace: "SyntheticValidNamespace",
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
          distinctId: "SyntheticValidDistinctId",
          event: "reservation started",
          properties: {
            provider_order_id: "SyntheticValidProviderId",
            session: "SyntheticValidSessionId",
            customer: "SyntheticValidCustomerId",
          },
          timestamp: Temporal.Instant.from("2026-06-17T10:00:00.000Z"),
          uuid: "SyntheticValidEventId",
        })
        .pipe(
          Effect.annotateLogs({
            correlationId: "SyntheticValidCorrelationId",
            sessionId: "SyntheticValidAnnotationSessionId",
            token: "SyntheticValidAnnotationToken",
          }),
          Effect.withSpan("reservation.attachHold", {
            attributes: {
              paymentAttemptId: "SyntheticValidPaymentAttemptId",
              secret: "SyntheticValidSpanSecret",
            },
          })
        )
    );

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      distinctId: "deskohub-workspace:lifecycle",
      event: "reservation started",
      timestamp: new Date("2026-06-17T10:00:00.000Z"),
    });
    expect(messages[0].uuid).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
    expect(messages[0].properties).toMatchObject({
      "deployment.environment.name": "development",
      operation: CENSORED_LOG_VALUE,
      "service.name": "deskohub-workspace",
      "service.namespace": "deskohub",
    });
    expect(JSON.stringify(messages[0])).not.toContain("SyntheticValid");
  });

  test("does nothing without a configured client", async () => {
    const { makePostHogEventService } = await import("./posthog-event.service");
    const service = makePostHogEventService({ config });

    await Effect.runPromise(
      service.capture({
        distinctId: "reservation-id",
        event: "reservation started",
        timestamp: Temporal.Instant.from("2026-06-17T10:00:00.000Z"),
        uuid: "019edbcf-5026-7ecc-821b-eda46998eaaa",
      })
    );
  });
});
