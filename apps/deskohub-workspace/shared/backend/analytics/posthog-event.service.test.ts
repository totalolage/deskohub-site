import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { Cause, Effect } from "effect";
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
    const hostedPageMarker = randomUUID();
    const credentialMarker = randomUUID();
    const hostedPage = `https://provider.example/hosted?opaque=${hostedPageMarker}`;
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
            hostedPage,
            providerRedirectUrl: hostedPage,
            securityToken: credentialMarker,
          },
          timestamp: Temporal.Instant.from("2026-06-17T10:00:00.000Z"),
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
              hppUrl: hostedPage,
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
      hostedPage: CENSORED_LOG_VALUE,
      providerRedirectUrl: CENSORED_LOG_VALUE,
      securityToken: CENSORED_LOG_VALUE,
    });
    expect(messages[0].properties?.effect).toMatchObject({
      spanAttributes: {
        paymentAttemptId: "payment-attempt-id",
        secret: CENSORED_LOG_VALUE,
        hppUrl: CENSORED_LOG_VALUE,
      },
    });
    const serialized = JSON.stringify(messages);
    expect(serialized).not.toContain(hostedPageMarker);
    expect(serialized).not.toContain(credentialMarker);
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

  test("censors direct span names and Effect Cause payloads before capture", async () => {
    const { makePostHogEventService } = await import("./posthog-event.service");
    const messages: EventMessage[] = [];
    const spanMarker = randomUUID();
    const failureMarker = randomUUID();
    const defectMarker = randomUUID();
    const exceptionTypeMarker = randomUUID();
    const service = makePostHogEventService({
      client: {
        captureImmediate: (message) => {
          messages.push(message);
          return Promise.resolve();
        },
      },
      config,
    });
    const cause = Cause.combine(
      Cause.fail(failureMarker),
      Cause.die({ opaque: defectMarker })
    );

    await Effect.runPromise(
      service
        .capture({
          distinctId: "reservation-id",
          event: "reservation started",
          properties: { "exception.type": exceptionTypeMarker },
          timestamp: Temporal.Instant.from("2026-06-17T10:00:00.000Z"),
          uuid: "019edbcf-5026-7ecc-821b-eda46998eaaa",
        })
        .pipe(
          Effect.annotateLogs({ providerCause: cause }),
          Effect.withSpan(
            `https://provider.example/hosted?opaque=${spanMarker}`
          )
        )
    );

    expect(messages).toHaveLength(1);
    expect(messages[0]?.properties?.["effect.span_name"]).toBe(
      CENSORED_LOG_VALUE
    );
    const serialized = JSON.stringify(messages);
    expect(serialized).toContain(CENSORED_LOG_VALUE);
    expect(serialized).not.toContain(spanMarker);
    expect(serialized).not.toContain(failureMarker);
    expect(serialized).not.toContain(defectMarker);
    expect(serialized).not.toContain(exceptionTypeMarker);
  });
});
