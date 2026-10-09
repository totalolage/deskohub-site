import { Effect } from "effect";
import { NextResponse } from "next/server";
import { PaymentRefundService } from "@/features/checkout/backend/payment";
import { isAuthorizedCronRequest } from "@/shared/backend/cron-request";
import { defineWorkspaceRoute } from "@/shared/backend/workspace-route";

const cronBatchLimit = 25;

/**
 * Fallback for refund notifications Nexi does not deliver: re-reads the Nexi
 * orders of the paid attempts awaiting a refund that were checked longest ago
 * and records any refund an operator already made in the Nexi back office.
 */
const reconcileAwaitingRefunds = Effect.fn("reconcileAwaitingRefunds")(
  function* () {
    const refunds = yield* PaymentRefundService;
    const input = { limit: cronBatchLimit };
    yield* Effect.annotateLogsScoped({ input });
    yield* Effect.logInfo("Payment refund reconciliation started");

    const result = yield* refunds.reconcileAwaitingRefunds(input);
    yield* Effect.annotateLogsScoped({ result });
    yield* Effect.logInfo("Payment refund reconciliation completed");

    return NextResponse.json(result);
  },
  Effect.scoped
);

const handlePaymentRefundCronError = Effect.fn("handlePaymentRefundCronError")(
  function* (cause: unknown) {
    yield* Effect.logError("Payment refund reconciliation cron failed", {
      cause,
    });

    return NextResponse.json(
      { error: "Payment refund reconciliation failed" },
      { status: 500 }
    );
  }
);

export const GET = defineWorkspaceRoute(
  {
    operation: "paymentRefundReconciliationCron",
    cancellation: "continue-after-disconnect",
  },
  (request) => {
    if (!isAuthorizedCronRequest(request)) {
      return Effect.logWarning(
        "Unauthorized payment refund reconciliation cron request"
      ).pipe(
        Effect.as(NextResponse.json({ error: "Unauthorized" }, { status: 401 }))
      );
    }

    return reconcileAwaitingRefunds().pipe(
      Effect.provide(PaymentRefundService.Live),
      Effect.catch(handlePaymentRefundCronError)
    );
  }
);
