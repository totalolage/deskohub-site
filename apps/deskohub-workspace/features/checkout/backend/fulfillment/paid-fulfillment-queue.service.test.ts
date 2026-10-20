import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import { DuplicateMessageError } from "@vercel/queue";
import { Effect, Layer } from "effect";
import { WorkspaceReservationRepository } from "@/features/reservation/backend/workspace-reservation.repository";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import { WorkspacePaidFulfillmentService } from "./paid-fulfillment.service";
import {
  makePaidFulfillmentQueueService,
  paidFulfillmentQueueTopic,
} from "./paid-fulfillment-queue.service";
import { processPaidFulfillmentMessage } from "./paid-fulfillment-queue-consumer";
import { reconcileStalledPaidFulfillments } from "./paid-fulfillment-reconciliation";

const orderId = "reservation-id" as WorkspaceReservationId;

const processMessage = (input: {
  readonly message: unknown;
  readonly fulfillPaidOrder: ReturnType<typeof mock>;
  readonly fulfillmentStateAfter?: string;
}) =>
  processPaidFulfillmentMessage(input.message).pipe(
    Effect.provide(
      Layer.mergeAll(
        Layer.mock(WorkspacePaidFulfillmentService, {
          fulfillPaidOrder: input.fulfillPaidOrder,
        }),
        Layer.mock(WorkspaceReservationRepository, {
          findById: mock(() =>
            Effect.succeed({
              id: orderId,
              paymentState: "paid",
              fulfillmentState: input.fulfillmentStateAfter ?? "fulfilled",
            } as never)
          ),
        })
      )
    ),
    Effect.result,
    Effect.runPromise
  );

describe("paid fulfillment queue", () => {
  test("enqueues one idempotent message per order", async () => {
    const send = mock(() => Promise.resolve({} as never));
    await makePaidFulfillmentQueueService(send as never)
      .enqueue({ orderId })
      .pipe(Effect.runPromise);

    expect(send).toHaveBeenCalledWith(
      paidFulfillmentQueueTopic,
      { orderId },
      expect.objectContaining({
        idempotencyKey: "paid-fulfillment:reservation-id",
      })
    );
  });

  test("treats a duplicate message as already enqueued", async () => {
    const send = mock(() =>
      Promise.reject(new DuplicateMessageError("duplicate"))
    );
    const result = await makePaidFulfillmentQueueService(send as never)
      .enqueue({ orderId })
      .pipe(Effect.result, Effect.runPromise);

    expect(result._tag).toBe("Success");
  });

  test("fails with a typed error when the queue rejects the message", async () => {
    const send = mock(() => Promise.reject(new Error("queue down")));
    const result = await makePaidFulfillmentQueueService(send as never)
      .enqueue({ orderId })
      .pipe(Effect.result, Effect.runPromise);

    expect(result).toMatchObject({
      failure: { _tag: "PaidFulfillmentQueueError" },
    });
  });

  for (const fulfillmentStateAfter of ["not_started", "processing"]) {
    test(`redelivers while fulfillment is still ${fulfillmentStateAfter}`, async () => {
      const result = await processMessage({
        message: { orderId },
        fulfillPaidOrder: mock(() => Effect.fail(new Error("transient"))),
        fulfillmentStateAfter,
      });

      expect(result).toMatchObject({
        failure: {
          _tag: "PaidFulfillmentPendingError",
          orderId,
          fulfillmentState: fulfillmentStateAfter,
        },
      });
    });
  }

  test("settles the message once fulfillment has failed terminally", async () => {
    const result = await processMessage({
      message: { orderId },
      fulfillPaidOrder: mock(() => Effect.fail(new Error("terminal"))),
      fulfillmentStateAfter: "failed",
    });

    expect(result).toMatchObject({ success: "processed" });
  });

  test("ignores malformed messages", async () => {
    const fulfillPaidOrder = mock(() => Effect.die("unused"));
    const result = await processMessage({
      message: { orderId: "" },
      fulfillPaidOrder,
    });

    expect(result).toMatchObject({ success: "ignored" });
    expect(fulfillPaidOrder).not.toHaveBeenCalled();
  });

  test("retries fulfillment for paid orders stalled past the queue's window", async () => {
    const now = Temporal.Instant.from("2026-10-11T06:00:00Z");
    const stalledOrderIds = [
      "stalled-a",
      "stalled-b",
    ] as WorkspaceReservationId[];
    const selectStalledPaidFulfillments = mock(() =>
      Effect.succeed(stalledOrderIds)
    );
    const fulfillPaidOrder = mock((input: { orderId: string }) =>
      input.orderId === "stalled-a"
        ? Effect.fail(new Error("dotypos down") as never)
        : Effect.void
    );

    const result = await reconcileStalledPaidFulfillments({
      now,
      limit: 25,
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          Layer.mock(WorkspacePaidFulfillmentService, { fulfillPaidOrder }),
          Layer.mock(WorkspaceReservationRepository, {
            selectStalledPaidFulfillments,
          })
        )
      ),
      Effect.runPromise
    );

    expect(selectStalledPaidFulfillments).toHaveBeenCalledWith({
      updatedBefore: Temporal.Instant.from("2026-10-11T05:45:00Z"),
      limit: 25,
    });
    expect(fulfillPaidOrder.mock.calls.map(([input]) => input)).toEqual([
      { orderId: "stalled-a" },
      { orderId: "stalled-b" },
    ]);
    expect(result).toEqual({ attempted: 2, failed: 1 });
  });

  test("wires the fulfillment topic to its queue route", async () => {
    const config = await Bun.file(
      new URL("../../../../vercel.json", import.meta.url)
    ).json();
    expect(
      config.functions["app/api/queues/workspace/paid-fulfillment/route.ts"]
        .experimentalTriggers
    ).toContainEqual(
      expect.objectContaining({
        type: "queue/v2beta",
        topic: paidFulfillmentQueueTopic,
      })
    );
  });
});
