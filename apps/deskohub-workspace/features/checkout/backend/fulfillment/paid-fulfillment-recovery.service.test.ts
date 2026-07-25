import "@/shared/polyfills/temporal";
import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import { Effect, Layer } from "effect";
import type { PaidFulfillmentJob } from "@/db/schema";
import {
  PaidFulfillmentRepository,
  type PaidFulfillmentRepository as PaidFulfillmentRepositoryType,
} from "./paid-fulfillment.repository";
import {
  WorkspacePaidFulfillmentService,
  type WorkspacePaidFulfillmentService as WorkspacePaidFulfillmentServiceType,
} from "./paid-fulfillment.service";
import {
  getPaidFulfillmentQueueMessage,
  PaidFulfillmentQueueService,
  PaidFulfillmentRecoveryService,
  paidFulfillmentQueueTopic,
  processPaidFulfillmentQueueMessage,
} from "./paid-fulfillment-recovery.service";

const now = Temporal.Instant.from("2026-07-25T10:05:00Z");

const job = {
  id: "job-id",
  paymentPaidEventId: "event-id",
  workspaceReservationId: "reservation-id",
  state: "pending",
  attemptCount: 0,
  leaseOwnerId: null,
  claimedAt: null,
  nextAttemptAt: Temporal.Instant.from("2026-07-25T10:00:00Z"),
  completedAt: null,
  failureCode: null,
  createdAt: Temporal.Instant.from("2026-07-25T10:00:00Z"),
  updatedAt: Temporal.Instant.from("2026-07-25T10:00:00Z"),
} satisfies PaidFulfillmentJob;

describe("PaidFulfillmentRecoveryService", () => {
  test("discovers and enqueues paid incomplete work without customer activity", async () => {
    const enqueue = mock(() => Effect.void);
    const result = await Effect.gen(function* () {
      const recovery = yield* PaidFulfillmentRecoveryService;
      return yield* recovery.sweep({ now, limit: 25 });
    }).pipe(
      Effect.provide(
        PaidFulfillmentRecoveryService.Live.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.succeed(PaidFulfillmentRepository, {
                reconcilePaidReservations: mock(() => Effect.succeed(1)),
                retireExhaustedLeases: mock(() => Effect.succeed(0)),
                selectDispatchable: mock(() => Effect.succeed([job])),
              } as unknown as PaidFulfillmentRepositoryType),
              Layer.succeed(PaidFulfillmentQueueService, { enqueue })
            )
          )
        )
      ),
      Effect.runPromise
    );

    expect(result).toEqual({
      discovered: 1,
      retired: 0,
      enqueued: 1,
      enqueueFailed: 0,
    });
    expect(enqueue).toHaveBeenCalledWith(job);
  });

  test("completes the durable job only after delivery dispatch", async () => {
    const claimed = {
      ...job,
      state: "processing" as const,
      attemptCount: 1,
      leaseOwnerId: "worker-id",
      claimedAt: now,
    };
    const markCompleted = mock(() => Effect.succeed(true));
    const markAttemptFailed = mock(() => Effect.succeed("retry" as const));
    const result = await processPaidFulfillmentQueueMessage(
      { schemaVersion: 1, jobId: job.id },
      now,
      "worker-id"
    ).pipe(
      Effect.provide(
        Layer.mergeAll(
          Layer.succeed(PaidFulfillmentRepository, {
            claim: mock(() => Effect.succeed(claimed)),
            markCompleted,
            markAttemptFailed,
          } as unknown as PaidFulfillmentRepositoryType),
          Layer.succeed(WorkspacePaidFulfillmentService, {
            fulfillPaidOrder: mock(() =>
              Effect.succeed("delivery_dispatched" as const)
            ),
          } satisfies WorkspacePaidFulfillmentServiceType)
        )
      ),
      Effect.runPromise
    );

    expect(result).toBe("completed");
    expect(markCompleted).toHaveBeenCalledWith({
      id: job.id,
      ownerId: "worker-id",
      completedAt: now,
    });
    expect(markAttemptFailed).not.toHaveBeenCalled();
  });

  test("reschedules incomplete work with bounded backoff", async () => {
    const claimed = {
      ...job,
      state: "processing" as const,
      attemptCount: 3,
      leaseOwnerId: "worker-id",
      claimedAt: now,
    };
    const markAttemptFailed = mock(() => Effect.succeed("retry" as const));
    const result = await processPaidFulfillmentQueueMessage(
      { schemaVersion: 1, jobId: job.id },
      now,
      "worker-id"
    ).pipe(
      Effect.provide(
        Layer.mergeAll(
          Layer.succeed(PaidFulfillmentRepository, {
            claim: mock(() => Effect.succeed(claimed)),
            markCompleted: mock(() => Effect.succeed(false)),
            markAttemptFailed,
          } as unknown as PaidFulfillmentRepositoryType),
          Layer.succeed(WorkspacePaidFulfillmentService, {
            fulfillPaidOrder: mock(() => Effect.succeed("busy" as const)),
          } satisfies WorkspacePaidFulfillmentServiceType)
        )
      ),
      Effect.runPromise
    );

    expect(result).toBe("retry");
    expect(markAttemptFailed).toHaveBeenCalledWith({
      id: job.id,
      ownerId: "worker-id",
      failedAt: now,
      nextAttemptAt: now.add({ minutes: 20 }),
      failureCode: "paid_fulfillment_incomplete",
    });
  });

  test("uses a versioned PII-free queue message and wires cron and queue", async () => {
    expect(getPaidFulfillmentQueueMessage(job)).toEqual({
      topic: paidFulfillmentQueueTopic,
      payload: { schemaVersion: 1, jobId: "job-id" },
      options: {
        idempotencyKey: `paid-fulfillment:job-id:0:${job.nextAttemptAt.toString()}`,
        retentionSeconds: 86_400,
      },
    });

    const config = await Bun.file(
      new URL("../../../../vercel.json", import.meta.url)
    ).json();
    expect(config.crons).toContainEqual({
      path: "/api/cron/workspace/paid-fulfillment",
      schedule: "*/5 * * * *",
    });
    expect(
      config.functions["app/api/queues/workspace/paid-fulfillment/route.ts"]
        .experimentalTriggers
    ).toContainEqual({
      type: "queue/v2beta",
      topic: paidFulfillmentQueueTopic,
      retryAfterSeconds: 60,
      initialDelaySeconds: 0,
    });
  });
});
