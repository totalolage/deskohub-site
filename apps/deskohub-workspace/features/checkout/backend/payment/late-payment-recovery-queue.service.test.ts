import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import { Effect, Layer } from "effect";
import { LatePaymentRecoveryService } from "./late-payment-recovery.service";
import {
  latePaymentRecoveryQueueTopic,
  makeLatePaymentRecoveryQueueService,
  processLatePaymentRecoveryMessage,
} from "./late-payment-recovery-queue.service";

describe("late-payment recovery queue", () => {
  test("enqueues one idempotent retained recovery message", async () => {
    const send = mock(() => Promise.resolve({} as never));
    await makeLatePaymentRecoveryQueueService(send as never)
      .enqueue({ paymentAttemptId: "attempt-id" })
      .pipe(Effect.runPromise);

    expect(send).toHaveBeenCalledWith(
      latePaymentRecoveryQueueTopic,
      { schemaVersion: 1, paymentAttemptId: "attempt-id" },
      {
        retentionSeconds: 604_800,
        idempotencyKey: "late-payment-recovery:attempt-id",
      }
    );
  });

  test("decodes a valid message and invokes recovery", async () => {
    const recover = mock(() => Effect.succeed("recovered" as const));
    const outcome = await processLatePaymentRecoveryMessage({
      schemaVersion: 1,
      paymentAttemptId: "attempt-id",
    }).pipe(
      Effect.provide(Layer.mock(LatePaymentRecoveryService, { recover })),
      Effect.runPromise
    );

    expect(outcome).toBe("recovered");
    expect(recover).toHaveBeenCalledWith({ paymentAttemptId: "attempt-id" });
  });

  test("ignores malformed messages", async () => {
    const outcome = await processLatePaymentRecoveryMessage({}).pipe(
      Effect.provide(
        Layer.mock(LatePaymentRecoveryService, {
          recover: mock(() => Effect.die("unused")),
        })
      ),
      Effect.runPromise
    );
    expect(outcome).toBe("ignored");
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
