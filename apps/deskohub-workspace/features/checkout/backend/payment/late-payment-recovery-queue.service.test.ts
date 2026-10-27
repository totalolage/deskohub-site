import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { decodeStandardSchema } from "@deskohub/standard-schema";
import { Effect, Layer } from "effect";
import type { PaymentAttemptId } from "@/features/checkout/checkout-identifiers";
import {
  makeMemoryQueue,
  unavailableQueue,
} from "@/shared/backend/queue/memory-queue.test-utils";
import type { QueuePublisher } from "@/shared/backend/queue/queue-publisher";
import {
  LatePaymentRecoveryQueueService,
  latePaymentRecoveryTopic,
} from "./late-payment-recovery-queue.service";

const paymentAttemptId = "attempt-id" as PaymentAttemptId;

const enqueue = (queue: Layer.Layer<QueuePublisher>) =>
  Effect.flatMap(LatePaymentRecoveryQueueService, (service) =>
    service.enqueue({ paymentAttemptId })
  ).pipe(
    Effect.provide(
      LatePaymentRecoveryQueueService.Default.pipe(Layer.provide(queue))
    ),
    Effect.result,
    Effect.runPromise
  );

describe("late-payment recovery queue", () => {
  // The key is the recovery's idempotency: a changed key would publish a
  // second recovery for the same payment.
  test("enqueues one idempotent recovery message per attempt", async () => {
    const queue = makeMemoryQueue();

    await enqueue(queue.layer);

    expect(queue.published()).toEqual([
      {
        topic: "workspace-late-payment-recovery",
        message: { paymentAttemptId: "attempt-id" },
        options: {
          retentionSeconds: 7 * 24 * 60 * 60,
          idempotencyKey: "late-payment-recovery:attempt-id",
        },
      },
    ]);
    expect(JSON.stringify(queue.published()[0]?.message)).toBe(
      '{"paymentAttemptId":"attempt-id"}'
    );
  });

  test("treats a duplicate message as already enqueued", async () => {
    const queue = makeMemoryQueue();

    await enqueue(queue.layer);
    const result = await enqueue(queue.layer);

    expect(result._tag).toBe("Success");
    expect(queue.published()).toHaveLength(1);
  });

  test("fails with a typed error carrying the queue's cause", async () => {
    const cause = new Error("queue down");
    const result = await enqueue(unavailableQueue(cause));

    expect(result).toMatchObject({
      failure: { _tag: "LatePaymentRecoveryQueueError", cause },
    });
  });

  test("decodes only well-formed messages", () => {
    for (const message of [{}, { paymentAttemptId: "" }]) {
      expect(
        decodeStandardSchema(latePaymentRecoveryTopic.message, message)
      ).toBeUndefined();
    }
    expect(
      decodeStandardSchema(latePaymentRecoveryTopic.message, {
        paymentAttemptId,
      })
    ).toEqual({ paymentAttemptId });
  });
});
