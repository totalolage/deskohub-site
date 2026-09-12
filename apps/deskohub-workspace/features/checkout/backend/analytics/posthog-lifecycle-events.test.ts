import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { PostHogDistinctId } from "@deskohub/posthog/identifiers";
import { Effect, Layer } from "effect";
import type { CapturePostHogEventInput } from "@/shared/backend/analytics/posthog-event.service";
import { withWorkspaceRequestContext } from "@/shared/backend/workspace-request-context";
import {
  POSTHOG_DISTINCT_ID_COOKIE,
  POSTHOG_SESSION_ID_COOKIE,
} from "@/shared/utils/posthog-session-cookies";

const consentCookie = (categories: readonly string[]) =>
  `cc_cookie=${encodeURIComponent(JSON.stringify({ categories }))}`;

describe("PostHog lifecycle events", () => {
  test("captures payment revenue fields with deterministic UUID", async () => {
    const { capturePaymentCompleted } = await import(
      "./posthog-lifecycle-events"
    );
    const { PostHogEventService } = await import(
      "@/shared/backend/analytics/posthog-event.service"
    );
    const captures: CapturePostHogEventInput[] = [];
    const attemptId = "019edbd2-82f7-7cc0-8536-f2b3874d62d5";
    const reservationId = "019edbcf-5026-7ecc-821b-eda46998eaaa";
    const timestamp = Temporal.Instant.from("2026-06-17T12:00:00.000Z");

    await Effect.runPromise(
      capturePaymentCompleted({
        attempt: {
          id: attemptId,
          workspaceReservationId: reservationId,
          provider: "nexi",
          providerOrderId: "provider-order-id",
          amount: {
            value: 35_000,
            exponent: 2,
            currency: "CZK",
          },
        },
        timestamp,
      }).pipe(
        Effect.provide(
          Layer.succeed(PostHogEventService, {
            alias: () => Effect.void,
            capture: (input) =>
              Effect.sync(() => {
                captures.push(input);
              }),
          })
        )
      )
    );

    expect(captures).toHaveLength(1);
    expect(captures[0]).toMatchObject({
      distinctId: reservationId,
      event: "payment completed",
      properties: {
        $process_person_profile: false,
      },
      timestamp,
      uuid: `${attemptId}:payment completed`,
    });
    expect(captures[0].properties).toMatchObject({
      currency: "CZK",
      payment_attempt_id: attemptId,
      provider: "nexi",
      provider_order_id: "provider-order-id",
      reservation_id: reservationId,
      revenue: 350,
    });
  });

  test("captures an internal zero-total payment without external provider fields", async () => {
    const { capturePaymentCompleted } = await import(
      "./posthog-lifecycle-events"
    );
    const { PostHogEventService } = await import(
      "@/shared/backend/analytics/posthog-event.service"
    );
    const captures: CapturePostHogEventInput[] = [];
    const attemptId = "019edbd2-82f7-7cc0-8536-f2b3874d62d6";
    const reservationId = "019edbcf-5026-7ecc-821b-eda46998eaab";
    const timestamp = Temporal.Instant.from("2026-06-17T12:00:00.000Z");

    await Effect.runPromise(
      capturePaymentCompleted({
        attempt: {
          id: attemptId,
          workspaceReservationId: reservationId,
          provider: "internal",
          providerOrderId: null,
          amount: {
            value: 0,
            exponent: 2,
            currency: "CZK",
          },
        },
        timestamp,
      }).pipe(
        Effect.provide(
          Layer.succeed(PostHogEventService, {
            alias: () => Effect.void,
            capture: (input) =>
              Effect.sync(() => {
                captures.push(input);
              }),
          })
        )
      )
    );

    expect(captures[0]?.properties).toEqual({
      $process_person_profile: false,
      currency: "CZK",
      payment_attempt_id: attemptId,
      provider: "internal",
      reservation_id: reservationId,
      revenue: 0,
    });
  });

  test("keeps browser request events separate from durable lifecycle identity", async () => {
    const {
      captureAvailabilityResult,
      capturePaymentCompleted,
      capturePaymentStarted,
      capturePrePaymentOutcome,
      captureReservationAbandoned,
      captureReservationCompleted,
      captureReservationFulfilled,
      captureReservationStarted,
    } = await import("./posthog-lifecycle-events");
    const { PostHogEventService } = await import(
      "@/shared/backend/analytics/posthog-event.service"
    );
    const aliases: { alias: string; distinctId: string }[] = [];
    const captures: CapturePostHogEventInput[] = [];
    const browserId = PostHogDistinctId.make("synthetic-browser-id");
    const reservationId = "synthetic-reservation-id";
    const attemptId = "synthetic-payment-attempt-id";
    const checkoutAttemptId = "synthetic-checkout-attempt-id";
    const timestamp = Temporal.Instant.from("2099-06-17T12:00:00.000Z");
    const operations: string[] = [`capture:$pageview:${browserId}`];
    const service = Layer.succeed(PostHogEventService, {
      alias: (input) =>
        Effect.sync(() => {
          aliases.push(input);
          operations.push(`alias:${input.distinctId}:${input.alias}`);
        }),
      capture: (input) =>
        Effect.sync(() => {
          captures.push(input);
          operations.push(`capture:${input.event}:${input.distinctId}`);
        }),
    });
    const requestHeaders = new Headers({
      cookie: `${consentCookie(["necessary", "analytics"])}; ${POSTHOG_DISTINCT_ID_COOKIE}=${browserId}; ${POSTHOG_SESSION_ID_COOKIE}=synthetic-session-id`,
    });
    const paymentAttempt = {
      id: attemptId,
      workspaceReservationId: reservationId,
      provider: "nexi" as const,
      providerOrderId: "synthetic-provider-order-id",
      amount: { value: 35_000, exponent: 2, currency: "CZK" },
    };

    await Effect.runPromise(
      Effect.gen(function* () {
        yield* captureAvailabilityResult({
          checkoutAttemptId,
          result: "available",
          timestamp,
        });
        yield* capturePrePaymentOutcome({
          checkoutAttemptId,
          outcome: "transport_error",
          timestamp,
        });
        yield* capturePrePaymentOutcome({
          checkoutAttemptId,
          outcome: "prepared",
          timestamp,
        });
        yield* captureReservationStarted({
          reservation: {
            id: reservationId,
            dotyposReservationId: "synthetic-dotypos-reservation-id",
          },
          timestamp,
        });
        yield* capturePaymentStarted({ attempt: paymentAttempt, timestamp });
        yield* capturePaymentCompleted({ attempt: paymentAttempt, timestamp });
        yield* captureReservationCompleted({
          reservation: {
            id: reservationId,
            dotyposReservationId: "synthetic-dotypos-reservation-id",
          },
          timestamp,
        });
        yield* captureReservationFulfilled({
          reservation: {
            id: reservationId,
            dotyposCustomerId: "synthetic-dotypos-customer-id",
            dotyposReservationId: "synthetic-dotypos-reservation-id",
          },
          timestamp,
        });
        yield* captureReservationAbandoned({
          reservation: {
            id: reservationId,
            dotyposReservationId: "synthetic-dotypos-reservation-id",
          },
          timestamp,
        });
      }).pipe(
        Effect.provide(service),
        withWorkspaceRequestContext(requestHeaders)
      )
    );

    expect(aliases).toEqual([]);
    expect(operations).toEqual([
      `capture:$pageview:${browserId}`,
      `capture:availability result:${browserId}`,
      `capture:pre-payment outcome:${browserId}`,
      `capture:pre-payment outcome:${browserId}`,
      `capture:reservation started:${reservationId}`,
      `capture:payment started:${reservationId}`,
      `capture:payment completed:${reservationId}`,
      `capture:reservation completed:${reservationId}`,
      `capture:reservation fulfilled:${reservationId}`,
      `capture:reservation abandoned:${reservationId}`,
    ]);
    expect(captures.slice(0, 3)).toMatchObject([
      {
        distinctId: browserId,
        event: "availability result",
        properties: {
          $process_person_profile: false,
          $session_id: "synthetic-session-id",
          result: "available",
        },
        uuid: `${checkoutAttemptId}:availability result:available`,
      },
      {
        distinctId: browserId,
        event: "pre-payment outcome",
        properties: {
          $process_person_profile: false,
          $session_id: "synthetic-session-id",
          outcome: "transport_error",
        },
        uuid: `${checkoutAttemptId}:pre-payment outcome:transport_error`,
      },
      {
        distinctId: browserId,
        event: "pre-payment outcome",
        properties: {
          $process_person_profile: false,
          $session_id: "synthetic-session-id",
          outcome: "prepared",
        },
        uuid: `${checkoutAttemptId}:pre-payment outcome:prepared`,
      },
    ]);
    expect(captures.slice(3).map(({ distinctId }) => distinctId)).toEqual(
      Array(6).fill(reservationId)
    );
    for (const capture of captures.slice(3)) {
      expect(capture.properties).toMatchObject({
        $process_person_profile: false,
      });
    }
    const fulfilledCapture = captures.find(
      ({ event }) => event === "reservation fulfilled"
    );
    expect(fulfilledCapture).toBeDefined();
    expect(fulfilledCapture?.properties).not.toHaveProperty(
      "dotypos_customer_id"
    );
  });

  test("skips request events without a consented browser identity", async () => {
    const { captureAvailabilityResult, capturePrePaymentOutcome } =
      await import("./posthog-lifecycle-events");
    const { PostHogEventService } = await import(
      "@/shared/backend/analytics/posthog-event.service"
    );
    const aliases: unknown[] = [];
    const captures: CapturePostHogEventInput[] = [];
    const requestHeaders = new Headers({
      cookie: `${consentCookie(["necessary"])}; ${POSTHOG_DISTINCT_ID_COOKIE}=synthetic-browser-id; ${POSTHOG_SESSION_ID_COOKIE}=synthetic-session-id`,
    });

    await Effect.runPromise(
      Effect.gen(function* () {
        yield* captureAvailabilityResult({
          checkoutAttemptId: "synthetic-no-consent-checkout-attempt-id",
          result: "available",
          timestamp: Temporal.Instant.from("2099-06-17T12:00:00.000Z"),
        });
        yield* capturePrePaymentOutcome({
          checkoutAttemptId: "synthetic-no-consent-checkout-attempt-id",
          outcome: "prepared",
          timestamp: Temporal.Instant.from("2099-06-17T12:00:00.000Z"),
        });
      }).pipe(
        Effect.provide(
          Layer.succeed(PostHogEventService, {
            alias: (input) =>
              Effect.sync(() => {
                aliases.push(input);
              }),
            capture: (input) =>
              Effect.sync(() => {
                captures.push(input);
              }),
          })
        ),
        withWorkspaceRequestContext(requestHeaders)
      )
    );

    expect(aliases).toEqual([]);
    expect(captures).toEqual([]);
  });

  test("skips request events when the consented context has no browser identity", async () => {
    const { captureAvailabilityResult } = await import(
      "./posthog-lifecycle-events"
    );
    const { PostHogEventService } = await import(
      "@/shared/backend/analytics/posthog-event.service"
    );
    const captures: CapturePostHogEventInput[] = [];
    const requestHeaders = new Headers({
      cookie: consentCookie(["necessary", "analytics"]),
    });

    await Effect.runPromise(
      captureAvailabilityResult({
        checkoutAttemptId: "synthetic-no-browser-id-checkout-attempt-id",
        result: "available",
        timestamp: Temporal.Instant.from("2099-06-17T12:00:00.000Z"),
      }).pipe(
        Effect.provide(
          Layer.succeed(PostHogEventService, {
            alias: () => Effect.void,
            capture: (input) =>
              Effect.sync(() => {
                captures.push(input);
              }),
          })
        ),
        withWorkspaceRequestContext(requestHeaders)
      )
    );

    expect(captures).toEqual([]);
  });
});
