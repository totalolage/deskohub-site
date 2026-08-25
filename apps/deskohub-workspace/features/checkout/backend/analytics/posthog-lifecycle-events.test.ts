import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { Effect, Layer } from "effect";
import type { CapturePostHogEventInput } from "@/shared/backend/analytics/posthog-event.service";

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
          orderId: reservationId,
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
      timestamp,
      uuid: `${attemptId}:payment completed`,
    });
    expect(captures[0].properties).toMatchObject({
      currency: "CZK",
      payment_attempt_id: attemptId,
      order_id: reservationId,
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
          orderId: reservationId,
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
            capture: (input) =>
              Effect.sync(() => {
                captures.push(input);
              }),
          })
        )
      )
    );

    expect(captures[0]?.properties).toEqual({
      currency: "CZK",
      order_id: reservationId,
      payment_attempt_id: attemptId,
      provider: "internal",
      reservation_id: reservationId,
      revenue: 0,
    });
  });
});
