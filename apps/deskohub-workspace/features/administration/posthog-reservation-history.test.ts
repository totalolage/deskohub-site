import { afterEach, describe, expect, test } from "bun:test";
import { PostHogProjectId } from "@deskohub/posthog/identifiers";
import { Effect, Layer } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import { workspaceReservationIdSchema } from "@/features/reservation/persistence-contracts";
import {
  mergeReservationHistory,
  PostHogHistoryRuntimeConfig,
  PostHogReservationHistory,
} from "./posthog-reservation-history";

afterEach(() => {
  globalThis.fetch = originalFetch;
});

const originalFetch = globalThis.fetch;
const reservationId = workspaceReservationIdSchema.make("reservation-id");

describe("PostHog reservation history", () => {
  test("uses a parameterized scoped query and decodes approved fields", async () => {
    let capturedBody: unknown;
    globalThis.fetch = async (input, init) => {
      const request =
        input instanceof Request ? input : new Request(input, init);
      capturedBody = await request.clone().json();
      return Response.json({
        results: [
          [
            "payment started",
            "2026-08-04T12:30:00.000",
            "event-uuid",
            "attempt-id",
            "nexi",
          ],
        ],
      });
    };
    const layer = PostHogReservationHistory.Default.pipe(
      Layer.provide(
        Layer.succeed(PostHogHistoryRuntimeConfig, {
          apiKey: "test-key",
          environment: "preview",
          host: "https://eu.posthog.test",
          projectId: PostHogProjectId.make("42"),
          serviceName: "deskohub-workspace",
        })
      ),
      Layer.provide(FetchHttpClient.layer)
    );

    const result = await Effect.gen(function* () {
      const history = yield* PostHogReservationHistory;
      return yield* history.load(reservationId);
    }).pipe(Effect.provide(layer), Effect.runPromise);

    expect(result).toEqual({
      kind: "available",
      items: [
        {
          id: "posthog-event-uuid",
          title: "Payment started",
          description: "An online payment attempt began.",
          occurredAt: "2026-08-04T12:30:00Z",
          tone: "neutral",
        },
      ],
    });
    expect(capturedBody).toMatchObject({
      query: {
        kind: "HogQLQuery",
        values: {
          environment: "preview",
          reservationId: "reservation-id",
          serviceName: "deskohub-workspace",
        },
      },
      refresh: "blocking",
    });
  });

  test("is unavailable without the PostHog API key", async () => {
    const layer = PostHogReservationHistory.Default.pipe(
      Layer.provide(
        Layer.succeed(PostHogHistoryRuntimeConfig, {
          environment: "development",
          serviceName: "deskohub-workspace",
        })
      ),
      Layer.provide(FetchHttpClient.layer)
    );
    const result = await Effect.gen(function* () {
      const history = yield* PostHogReservationHistory;
      return yield* history.load(reservationId);
    }).pipe(Effect.provide(layer), Effect.runPromise);
    expect(result).toEqual({ kind: "unavailable" });
  });

  test("deduplicates durable milestones while preserving additional observations", () => {
    const durable = [
      {
        id: "durable-paid",
        title: "Payment received",
        description: "The reservation payment completed.",
        occurredAt: "2026-08-04T12:30:00Z",
        tone: "positive" as const,
      },
    ];
    expect(
      mergeReservationHistory({
        durable,
        history: {
          kind: "available",
          items: [
            {
              id: "observed-payment-started",
              title: "Payment started",
              description: "An online payment attempt began.",
              occurredAt: "2026-08-04T12:25:00Z",
              tone: "neutral",
            },
            {
              id: "observed-paid",
              title: "Payment received",
              description: "A completed payment was observed.",
              occurredAt: "2026-08-04T12:30:01Z",
              tone: "positive",
            },
          ],
        },
      }).map(({ title }) => title)
    ).toEqual(["Payment started", "Payment received"]);
  });
});
