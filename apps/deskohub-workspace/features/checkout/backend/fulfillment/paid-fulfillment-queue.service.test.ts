import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import { DuplicateMessageError } from "@vercel/queue";
import { Effect, Layer, Result } from "effect";
import {
  type PaidFulfillmentProgress,
  WorkspaceReservationRepository,
} from "@/features/reservation/backend/workspace-reservation.repository";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import { QueueRedelivery } from "@/shared/backend/queue/queue-consumer";
import {
  WorkspacePaidFulfillmentError,
  WorkspacePaidFulfillmentService,
} from "./paid-fulfillment.service";
import {
  makePaidFulfillmentQueueService,
  paidFulfillmentQueueTopic,
} from "./paid-fulfillment-queue.service";
import {
  paidFulfillmentRedelivery,
  processPaidFulfillmentMessage,
} from "./paid-fulfillment-queue-consumer";
import { reconcileStalledPaidFulfillments } from "./paid-fulfillment-reconciliation";

const orderId = "reservation-id" as WorkspaceReservationId;

const heldPaidProgress = {
  paymentState: "paid",
  reservationState: "held",
  fulfillmentState: "not_started",
  latePaymentRecoveryState: null,
} as const satisfies PaidFulfillmentProgress;

const fulfillmentFailure = (
  failureCode: WorkspacePaidFulfillmentError["failureCode"]
) =>
  new WorkspacePaidFulfillmentError({
    orderId,
    failureCode,
    message: "Paid reservation fulfillment failed.",
  });

const processMessage = (input: {
  readonly message: unknown;
  readonly fulfillPaidOrder: ReturnType<typeof mock>;
  readonly progressAfter?: Partial<PaidFulfillmentProgress> | null;
}) =>
  processPaidFulfillmentMessage(input.message).pipe(
    Effect.provide(
      Layer.mergeAll(
        Layer.mock(WorkspacePaidFulfillmentService, {
          fulfillPaidOrder: input.fulfillPaidOrder,
        }),
        Layer.mock(WorkspaceReservationRepository, {
          findPaidFulfillmentProgress: mock(() =>
            Effect.succeed(
              input.progressAfter === null
                ? null
                : {
                    ...heldPaidProgress,
                    fulfillmentState: "fulfilled",
                    ...input.progressAfter,
                  }
            )
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

  for (const fulfillmentState of ["not_started", "processing"] as const) {
    test(`backs off while fulfillment is still ${fulfillmentState}`, async () => {
      const failure = fulfillmentFailure("fulfillment_order_load_failed");
      const result = await processMessage({
        message: { orderId },
        fulfillPaidOrder: mock(() => Effect.fail(failure)),
        progressAfter: { fulfillmentState },
      });

      expect(result).toMatchObject({
        failure: {
          _tag: "PaidFulfillmentPendingError",
          orderId,
          reason: "fulfillment_in_progress",
          cause: failure,
        },
      });
      expect(
        Result.isFailure(result) && paidFulfillmentRedelivery(result.failure)
      ).toEqual(QueueRedelivery.WithBackoff());
    });
  }

  test("backs off while another worker or a late-payment recovery holds the order", async () => {
    for (const progressAfter of [
      { fulfillmentState: "processing" },
      { latePaymentRecoveryState: "pending" },
      { latePaymentRecoveryState: "processing" },
    ] as const) {
      const result = await processMessage({
        message: { orderId },
        fulfillPaidOrder: mock(() => Effect.void),
        progressAfter: { fulfillmentState: "not_started", ...progressAfter },
      });

      expect(result).toMatchObject({
        failure: { _tag: "PaidFulfillmentPendingError" },
      });
    }
  });

  test("backs off a failed fulfillment the claim can retake", async () => {
    const failure = fulfillmentFailure("dotypos_reservation_failed");
    for (const reservationState of ["held", "confirmed"] as const) {
      const result = await processMessage({
        message: { orderId },
        fulfillPaidOrder: mock(() => Effect.fail(failure)),
        progressAfter: { fulfillmentState: "failed", reservationState },
      });

      expect(result).toMatchObject({
        failure: {
          _tag: "PaidFulfillmentPendingError",
          reason: "fulfillment_failed",
          cause: failure,
        },
      });
      expect(
        Result.isFailure(result) && paidFulfillmentRedelivery(result.failure)
      ).toEqual(QueueRedelivery.WithBackoff());
    }
  });

  test("acknowledges a failed fulfillment on a cancelled reservation and keeps its cause", async () => {
    const failure = fulfillmentFailure("dotypos_reservation_failed");
    const result = await processMessage({
      message: { orderId },
      fulfillPaidOrder: mock(() => Effect.fail(failure)),
      progressAfter: {
        fulfillmentState: "failed",
        reservationState: "cancelled",
      },
    });

    expect(result).toMatchObject({
      failure: {
        _tag: "PaidFulfillmentSettledFailureError",
        reason: "reservation_cancelled",
        cause: failure,
      },
    });
    expect(
      Result.isFailure(result) && paidFulfillmentRedelivery(result.failure)
    ).toEqual(QueueRedelivery.Never());
  });

  test.each([
    ["refund_required", { latePaymentRecoveryState: "refund_required" }],
    ["review_required", { latePaymentRecoveryState: "review_required" }],
  ] as const)(
    "settles an order whose late payment ended %s",
    async (_label, progressAfter) => {
      const result = await processMessage({
        message: { orderId },
        fulfillPaidOrder: mock(() => Effect.void),
        progressAfter: { fulfillmentState: "not_started", ...progressAfter },
      });

      expect(result).toMatchObject({
        success: "late_payment_recovery_settled",
      });
    }
  );

  test.each([
    [
      "a cancelled reservation",
      { fulfillmentState: "not_started", reservationState: "cancelled" },
      "reservation_cancelled",
    ],
    ["a fulfilled order", {}, "fulfillment_settled"],
    [
      "an unpaid order",
      { fulfillmentState: "not_started", paymentState: "pending" },
      "reservation_not_paid",
    ],
    ["a missing order", null, "reservation_missing"],
  ] as const)("settles %s", async (_label, progressAfter, reason) => {
    const result = await processMessage({
      message: { orderId },
      fulfillPaidOrder: mock(() => Effect.void),
      progressAfter,
    });

    expect(result).toMatchObject({ success: reason });
  });

  test("retries a failed invoice although the order is fulfilled", async () => {
    const result = await processMessage({
      message: { orderId },
      fulfillPaidOrder: mock(() =>
        Effect.fail(fulfillmentFailure("invoice_processing_failed"))
      ),
    });

    expect(result).toMatchObject({
      failure: {
        _tag: "PaidFulfillmentPendingError",
        reason: "invoice_processing_failed",
      },
    });
  });

  test("keeps redelivering a paid order in a state no fulfillment path expects", async () => {
    const result = await processMessage({
      message: { orderId },
      fulfillPaidOrder: mock(() => Effect.void),
      progressAfter: {
        fulfillmentState: "not_started",
        reservationState: "cancelling",
      },
    });

    expect(result).toMatchObject({
      failure: {
        _tag: "PaidFulfillmentPendingError",
        reason: "reservation_not_fulfillable",
      },
    });
  });

  test.each([
    "hold_expired",
    "confirming",
    "cancelling",
    "cancellation_failed",
  ] as const)(
    "keeps redelivering a failed fulfillment on a %s reservation",
    async (reservationState) => {
      const failure = fulfillmentFailure("dotypos_reservation_failed");
      const result = await processMessage({
        message: { orderId },
        fulfillPaidOrder: mock(() => Effect.fail(failure)),
        progressAfter: { fulfillmentState: "failed", reservationState },
      });

      expect(result).toMatchObject({
        failure: {
          _tag: "PaidFulfillmentPendingError",
          reason: "reservation_not_fulfillable",
          cause: failure,
        },
      });
    }
  );

  test.each(["refund_required", "review_required"] as const)(
    "acknowledges a failed fulfillment whose late payment ended %s",
    async (latePaymentRecoveryState) => {
      const failure = fulfillmentFailure("dotypos_reservation_failed");
      const result = await processMessage({
        message: { orderId },
        fulfillPaidOrder: mock(() => Effect.fail(failure)),
        progressAfter: { fulfillmentState: "failed", latePaymentRecoveryState },
      });

      expect(result).toMatchObject({
        failure: {
          _tag: "PaidFulfillmentSettledFailureError",
          reason: "late_payment_recovery_settled",
          cause: failure,
        },
      });
      expect(
        Result.isFailure(result) && paidFulfillmentRedelivery(result.failure)
      ).toEqual(QueueRedelivery.Never());
    }
  );

  test("leaves failures it does not own to the default redelivery", () => {
    expect(paidFulfillmentRedelivery(new Error("layer failed"))).toEqual(
      QueueRedelivery.Default()
    );
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
