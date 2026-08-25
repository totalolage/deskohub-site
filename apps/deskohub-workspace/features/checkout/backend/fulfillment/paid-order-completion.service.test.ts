import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import { Effect, Layer } from "effect";
import { ReservationInvoiceService } from "@/features/accounting/backend/reservation-invoice.service";
import { WorkspacePaidFulfillmentService } from "./paid-fulfillment.service";
import { PaidOrderCompletionService } from "./paid-order-completion.service";

const complete = async (kind: "goods" | "reservation") => {
  const fulfillPaidOrder = mock(() => Effect.void);
  const processByPaymentAttemptId = mock(() => Effect.void);
  const result = await Effect.gen(function* () {
    const service = yield* PaidOrderCompletionService;
    yield* service.complete({
      orderId: "order-id",
      kind,
      paymentAttemptId: "attempt-id",
    });
  }).pipe(
    Effect.provide(
      PaidOrderCompletionService.Default.pipe(
        Layer.provide(
          Layer.merge(
            Layer.mock(WorkspacePaidFulfillmentService, { fulfillPaidOrder }),
            Layer.mock(ReservationInvoiceService, { processByPaymentAttemptId })
          )
        )
      )
    ),
    Effect.runPromise
  );
  return { fulfillPaidOrder, processByPaymentAttemptId, result };
};

describe("PaidOrderCompletionService", () => {
  test("dispatches reservation fulfillment", async () => {
    const result = await complete("reservation");
    expect(result.fulfillPaidOrder).toHaveBeenCalledWith({
      orderId: "order-id",
    });
    expect(result.processByPaymentAttemptId).not.toHaveBeenCalled();
  });

  test("processes accounting for already-fulfilled goods", async () => {
    const result = await complete("goods");
    expect(result.processByPaymentAttemptId).toHaveBeenCalledWith({
      paymentAttemptId: "attempt-id",
    });
    expect(result.fulfillPaidOrder).not.toHaveBeenCalled();
  });
});
