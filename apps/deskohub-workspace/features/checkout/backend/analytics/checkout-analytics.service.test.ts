import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import {
  classifyAgentTraffic,
  unclassifiedTraffic,
} from "@/shared/agent-traffic/agent-traffic";
import type { AnalyticsEventMessage } from "@/shared/backend/analytics/analytics-event-delivery.service";
import { withWorkspaceRequestContext } from "@/shared/backend/workspace-request-context";
import {
  POSTHOG_DISTINCT_ID_COOKIE,
  POSTHOG_SESSION_ID_COOKIE,
} from "@/shared/utils/posthog-session-cookies";
import { reservationLifecycleEvents } from "../../reservation-lifecycle-events";
import type { ICheckoutAnalytics } from "./checkout-analytics.service";

const { CheckoutAnalytics } = await import("./checkout-analytics.service");
const { recordCheckoutAnalytics } = await import(
  "./checkout-analytics.service.mock"
);

const consentCookie = (categories: readonly string[]) =>
  `cc_cookie=${encodeURIComponent(JSON.stringify({ categories }))}`;

const sentPropertyKeys = (message: AnalyticsEventMessage | undefined) =>
  Object.keys(message?.properties ?? {}).sort();

// Every server event carries these, added by the server analytics capture.
const metadataKeys = [
  "deployment.environment.name",
  "effect.span_id",
  "effect.trace_id",
  "service.name",
  "service.namespace",
];

const reservationEventKeys = [
  "$process_person_profile",
  "agent_category",
  "agent_name",
  ...metadataKeys,
  "reservation_id",
].sort();

const paymentEventKeys = [
  "$process_person_profile",
  "agent_category",
  "agent_name",
  "currency",
  ...metadataKeys,
  "payment_attempt_id",
  "provider",
  "reservation_id",
  "revenue",
].sort();

const chatGptUserAgent =
  "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot";

const capture = <A>(
  operation: (analytics: ICheckoutAnalytics) => Effect.Effect<A>,
  context: <B>(effect: Effect.Effect<B>) => Effect.Effect<B> = (effect) =>
    effect
) => {
  const recorder = recordCheckoutAnalytics();
  return Effect.flatMap(CheckoutAnalytics, operation).pipe(
    Effect.provide(recorder.layer),
    context,
    Effect.runPromise,
    (run) => run.then(() => recorder.messages)
  );
};

describe("Checkout analytics", () => {
  test("captures payment revenue fields with deterministic UUID", async () => {
    const attemptId = "019edbd2-82f7-7cc0-8536-f2b3874d62d5";
    const reservationId = "019edbcf-5026-7ecc-821b-eda46998eaaa";
    const timestamp = Temporal.Instant.from("2026-06-17T12:00:00.000Z");

    const messages = await capture((analytics) =>
      analytics.paymentCompleted({
        attempt: {
          id: attemptId,
          workspaceReservationId: reservationId,
          provider: "nexi",
          amount: { value: 35_000, exponent: 2, currency: "CZK" },
        },
        timestamp,
      })
    );

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      distinctId: reservationId,
      event: "payment completed",
      timestamp,
      uuid: `${attemptId}:payment completed`,
    });
    expect(messages[0]?.properties).toEqual({
      $process_person_profile: false,
      // Work outside a request context, such as a scheduled task, is unclassified.
      agent_category: "unclassified",
      currency: "CZK",
      "deployment.environment.name": "development",
      "effect.span_id": expect.any(String),
      "effect.trace_id": expect.any(String),
      payment_attempt_id: attemptId,
      provider: "nexi",
      reservation_id: reservationId,
      revenue: 350,
      "service.name": "workspace-test",
      "service.namespace": "deskohub-test",
    });
  });

  test("sends exactly the lifecycle events the reservation history reads", async () => {
    const reservation = { id: "synthetic-reservation-id" };
    const attempt = {
      id: "synthetic-payment-attempt-id",
      workspaceReservationId: reservation.id,
      provider: "nexi" as const,
      amount: { value: 12_500, exponent: 2, currency: "CZK" },
    };
    const timestamp = Temporal.Instant.from("2099-06-17T12:00:00.000Z");

    const messages = await capture((analytics) =>
      Effect.all([
        analytics.reservationStarted({ reservation, timestamp }),
        analytics.reservationAbandoned({ reservation, timestamp }),
        analytics.reservationCompleted({ reservation, timestamp }),
        analytics.reservationFulfilled({ reservation, timestamp }),
        analytics.paymentStarted({ attempt, timestamp }),
        analytics.paymentCompleted({ attempt, timestamp }),
        analytics.paymentAbandoned({ attempt, timestamp }),
        analytics.paymentFailed({
          attempt,
          failureReason: "nexi_hpp_create_failed",
          timestamp,
        }),
      ])
    );

    expect(messages.map(({ event }) => event).sort()).toEqual(
      [...reservationLifecycleEvents].sort()
    );
    for (const message of messages) {
      // The history reads events by the reservation's distinct ID and its
      // `reservation_id` property.
      expect(message.distinctId).toBe(reservation.id);
      expect(message.properties.reservation_id).toBe(reservation.id);
      expect(message.uuid).toBe(
        message.event.startsWith("payment ")
          ? `${attempt.id}:${message.event}`
          : `${reservation.id}:${message.event}`
      );
    }
  });

  test("keeps browser request events separate from durable lifecycle identity", async () => {
    const browserId = "synthetic-browser-id";
    const reservationId = "synthetic-reservation-id";
    const attemptId = "synthetic-payment-attempt-id";
    const checkoutAttemptId = "synthetic-checkout-attempt-id";
    const timestamp = Temporal.Instant.from("2099-06-17T12:00:00.000Z");
    const requestHeaders = new Headers({
      cookie: `${consentCookie(["necessary", "analytics"])}; ${POSTHOG_DISTINCT_ID_COOKIE}=${browserId}; ${POSTHOG_SESSION_ID_COOKIE}=synthetic-session-id`,
      "user-agent": chatGptUserAgent,
      "signature-agent": '"https://chatgpt.com"',
    });
    const paymentAttempt = {
      id: attemptId,
      workspaceReservationId: reservationId,
      provider: "nexi" as const,
      amount: { value: 35_000, exponent: 2, currency: "CZK" },
    };

    const messages = await capture(
      (analytics) =>
        Effect.gen(function* () {
          yield* analytics.availabilityResult({
            checkoutAttemptId,
            result: "available",
            timestamp,
          });
          yield* analytics.prePaymentOutcome({
            checkoutAttemptId,
            outcome: "transport_error",
            timestamp,
          });
          yield* analytics.prePaymentOutcome({
            checkoutAttemptId,
            outcome: "prepared",
            timestamp,
          });
          yield* analytics.reservationStarted({
            reservation: { id: reservationId },
            timestamp,
          });
          yield* analytics.paymentStarted({
            attempt: paymentAttempt,
            timestamp,
          });
          yield* analytics.paymentCompleted({
            attempt: paymentAttempt,
            timestamp,
          });
          yield* analytics.reservationCompleted({
            reservation: { id: reservationId },
            timestamp,
          });
          yield* analytics.reservationFulfilled({
            reservation: { id: reservationId },
            timestamp,
          });
          yield* analytics.reservationAbandoned({
            reservation: { id: reservationId },
            timestamp,
          });
        }),
      withWorkspaceRequestContext(
        requestHeaders,
        classifyAgentTraffic(requestHeaders)
      )
    );

    expect(
      messages.map(({ event, distinctId }) => [event, distinctId])
    ).toEqual([
      ["availability result", browserId],
      ["pre-payment outcome", browserId],
      ["pre-payment outcome", browserId],
      ["reservation started", reservationId],
      ["payment started", reservationId],
      ["payment completed", reservationId],
      ["reservation completed", reservationId],
      ["reservation fulfilled", reservationId],
      ["reservation abandoned", reservationId],
    ]);
    expect(messages.slice(0, 3)).toMatchObject([
      {
        properties: {
          $process_person_profile: false,
          $session_id: "synthetic-session-id",
          result: "available",
        },
        uuid: `${checkoutAttemptId}:availability result:available`,
      },
      {
        properties: {
          $process_person_profile: false,
          $session_id: "synthetic-session-id",
          outcome: "transport_error",
        },
        uuid: `${checkoutAttemptId}:pre-payment outcome:transport_error`,
      },
      {
        properties: {
          $process_person_profile: false,
          $session_id: "synthetic-session-id",
          outcome: "prepared",
        },
        uuid: `${checkoutAttemptId}:pre-payment outcome:prepared`,
      },
    ]);
    // Lifecycle events never carry the browser's identity or session.
    for (const message of messages.slice(3)) {
      expect(message.properties).toMatchObject({
        $process_person_profile: false,
        reservation_id: reservationId,
      });
      expect(sentPropertyKeys(message)).toEqual(
        message.event.startsWith("payment ")
          ? paymentEventKeys
          : reservationEventKeys
      );
      expect(Object.values(message.properties)).not.toContain(browserId);
    }
    for (const message of messages) {
      expect(message.properties).toMatchObject({
        agent_category: "ai_user_agent",
        agent_name: "chatgpt",
      });
      for (const value of Object.values(message.properties)) {
        expect(String(value)).not.toContain("ChatGPT-User");
        expect(String(value)).not.toContain("chatgpt.com");
      }
    }
  });

  test("sends only the allowed properties on failed and abandoned payments", async () => {
    const attempt = {
      id: "synthetic-failed-payment-attempt-id",
      workspaceReservationId: "synthetic-failed-reservation-id",
      provider: "nexi" as const,
      amount: { value: 12_500, exponent: 2, currency: "CZK" },
    };
    const timestamp = Temporal.Instant.from("2099-06-17T12:00:00.000Z");
    const requestHeaders = new Headers({ "user-agent": chatGptUserAgent });

    const messages = await capture(
      (analytics) =>
        Effect.gen(function* () {
          yield* analytics.paymentFailed({
            attempt,
            failureReason: "nexi_payment_failed",
            timestamp,
          });
          yield* analytics.paymentAbandoned({ attempt, timestamp });
        }),
      withWorkspaceRequestContext(
        requestHeaders,
        classifyAgentTraffic(requestHeaders)
      )
    );

    expect(messages.map(({ event }) => event)).toEqual([
      "payment failed",
      "payment abandoned",
    ]);
    expect(messages[0]?.distinctId).toBe(attempt.workspaceReservationId);
    expect(messages[0]?.properties).toMatchObject({
      $process_person_profile: false,
      agent_category: "ai_user_agent",
      agent_name: "chatgpt",
      currency: "CZK",
      failure_reason: "nexi_payment_failed",
      payment_attempt_id: attempt.id,
      provider: "nexi",
      reservation_id: attempt.workspaceReservationId,
      revenue: 125,
    });
    expect(sentPropertyKeys(messages[0])).toEqual(
      [...paymentEventKeys, "failure_reason"].sort()
    );
    expect(sentPropertyKeys(messages[1])).toEqual(paymentEventKeys);
  });

  test("skips request events without a consented browser identity", async () => {
    const requestHeaders = new Headers({
      cookie: `${consentCookie(["necessary"])}; ${POSTHOG_DISTINCT_ID_COOKIE}=synthetic-browser-id; ${POSTHOG_SESSION_ID_COOKIE}=synthetic-session-id`,
    });
    const timestamp = Temporal.Instant.from("2099-06-17T12:00:00.000Z");

    const messages = await capture(
      (analytics) =>
        Effect.gen(function* () {
          yield* analytics.availabilityResult({
            checkoutAttemptId: "synthetic-no-consent-checkout-attempt-id",
            result: "available",
            timestamp,
          });
          yield* analytics.prePaymentOutcome({
            checkoutAttemptId: "synthetic-no-consent-checkout-attempt-id",
            outcome: "prepared",
            timestamp,
          });
        }),
      withWorkspaceRequestContext(requestHeaders, unclassifiedTraffic)
    );

    expect(messages).toEqual([]);
  });

  test("skips request events when the consented context has no browser identity", async () => {
    const requestHeaders = new Headers({
      cookie: consentCookie(["necessary", "analytics"]),
    });

    const messages = await capture(
      (analytics) =>
        analytics.availabilityResult({
          checkoutAttemptId: "synthetic-no-browser-id-checkout-attempt-id",
          result: "available",
          timestamp: Temporal.Instant.from("2099-06-17T12:00:00.000Z"),
        }),
      withWorkspaceRequestContext(requestHeaders, unclassifiedTraffic)
    );

    expect(messages).toEqual([]);
  });

  test("skips request events in work that serves no request", async () => {
    const messages = await capture((analytics) =>
      analytics.prePaymentOutcome({
        checkoutAttemptId: "synthetic-task-checkout-attempt-id",
        outcome: "prepared",
        timestamp: Temporal.Instant.from("2099-06-17T12:00:00.000Z"),
      })
    );

    expect(messages).toEqual([]);
  });
});
