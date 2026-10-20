import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import { Effect } from "effect";
import {
  latePaymentRecoveryQueueTopic,
  makeLatePaymentRecoveryQueueService,
} from "./late-payment-recovery-queue.service";

describe("late-payment recovery queue", () => {
  test("enqueues one idempotent recovery message per attempt", async () => {
    const send = mock(() => Promise.resolve({} as never));
    await makeLatePaymentRecoveryQueueService(send as never)
      .enqueue({ paymentAttemptId: "attempt-id" })
      .pipe(Effect.runPromise);

    expect(send).toHaveBeenCalledWith(
      latePaymentRecoveryQueueTopic,
      { paymentAttemptId: "attempt-id" },
      expect.objectContaining({
        idempotencyKey: "late-payment-recovery:attempt-id",
      })
    );
  });

  test("wires the recovery topic to its queue route", async () => {
    const config = await Bun.file(
      new URL("../../../../vercel.json", import.meta.url)
    ).json();
    expect(
      config.functions[
        "app/api/queues/workspace/late-payment-recovery/route.ts"
      ].experimentalTriggers
    ).toContainEqual(
      expect.objectContaining({
        type: "queue/v2beta",
        topic: latePaymentRecoveryQueueTopic,
      })
    );
  });
});
