import "@/shared/testing/workspace-test-env";

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import type { EmailSentEvent } from "@deskohub/email";
import { EmailDeliveryIdSchema } from "@deskohub/email";
import { Effect, Layer, Logger } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { makeDatabaseClient, makeDatabasePool } from "@/db/database-client";
import { makePostHogDeliveryTrackingObserver } from "./posthog-delivery-tracking-observer";

type LogRecord = {
  readonly level: string;
  readonly annotations: unknown;
};

const logRecords: LogRecord[] = [];
const logger = Logger.make((options) => {
  logRecords.push({
    level: options.logLevel,
    annotations: options.message[1],
  });
});

// Nothing listens on port 1, so every query fails to connect.
const unreachablePool = makeDatabasePool({
  connectionString: "postgresql://workspace@127.0.0.1:1/workspace",
  connectionTimeoutMillis: 1_000,
});
const unreachableDatabase = Layer.effect(
  WorkspaceDatabase,
  Effect.map(makeDatabaseClient(unreachablePool), WorkspaceDatabase.make)
);

const notifySent = (event: Partial<EmailSentEvent>) =>
  Effect.runPromise(
    makePostHogDeliveryTrackingObserver([]).pipe(
      Effect.flatMap((observer) =>
        observer.onSent({
          provider: "posthog",
          deliveryId: EmailDeliveryIdSchema.make("posthog-unrecorded"),
          stream: "marketing",
          category: "campaign",
          tags: ["campaign"],
          metadata: { deploymentEnvironment: "preview" },
          idempotencyKey: undefined,
          at: new Date("2026-11-09T12:00:00.000Z"),
          ...event,
        })
      ),
      Effect.exit,
      Effect.provide([unreachableDatabase, Logger.layer([logger])])
    )
  );

describe("PostHog delivery tracking observer", () => {
  beforeEach(() => {
    logRecords.length = 0;
  });
  afterAll(() => unreachablePool.end());

  test("logs a delivery it could not record instead of failing the send", async () => {
    const deliveryId = EmailDeliveryIdSchema.make("posthog-unrecorded");

    const exit = await notifySent({ deliveryId });

    expect(exit._tag).toBe("Success");
    expect(logRecords).toContainEqual({
      level: "Warn",
      annotations: expect.objectContaining({
        deliveryId,
        category: "campaign",
      }),
    });
  });

  test("logs a delivery with an invalid send time instead of failing the send", async () => {
    const deliveryId = EmailDeliveryIdSchema.make("posthog-invalid-time");

    const exit = await notifySent({ deliveryId, at: new Date(Number.NaN) });

    expect(exit._tag).toBe("Success");
    expect(logRecords).toContainEqual({
      level: "Warn",
      annotations: expect.objectContaining({ deliveryId }),
    });
  });
});
