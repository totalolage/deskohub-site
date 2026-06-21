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
    const timestamp = new Date("2026-06-17T12:00:00.000Z");

    await Effect.runPromise(
      capturePaymentCompleted({
        attempt: {
          id: attemptId,
          workspaceReservationId: reservationId,
          providerOrderId: "provider-order-id",
          amountValue: 35_000,
          amountExponent: 2,
          currency: "CZK",
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
      amount: 350,
      amount_exponent: 2,
      amount_value: 35_000,
      currency: "CZK",
      payment_attempt_id: attemptId,
      provider_order_id: "provider-order-id",
      reservation_id: reservationId,
    });
  });
});
