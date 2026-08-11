import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import {
  initialMobileShopPurchaseLifecycle,
  transitionMobileShopPurchase,
} from "./purchase-state";

describe("mobile shop purchase lifecycle", () => {
  test("makes paid terminal while allowing independent receipt and stock work", async () => {
    const pending = await Effect.runPromise(
      transitionMobileShopPurchase({
        lifecycle: initialMobileShopPurchaseLifecycle(),
        event: { kind: "payment_started" },
      })
    );
    const paid = await Effect.runPromise(
      transitionMobileShopPurchase({
        lifecycle: pending,
        event: { kind: "payment_paid" },
      })
    );
    const receipt = await Effect.runPromise(
      transitionMobileShopPurchase({
        lifecycle: paid,
        event: { kind: "receipt_claimed" },
      })
    );
    const stock = await Effect.runPromise(
      transitionMobileShopPurchase({
        lifecycle: paid,
        event: { kind: "stock_claimed" },
      })
    );

    expect(receipt).toMatchObject({
      paymentState: "paid",
      receiptState: "processing",
    });
    expect(stock).toMatchObject({
      paymentState: "paid",
      stockState: "processing",
    });
    const regression = await Effect.runPromiseExit(
      transitionMobileShopPurchase({
        lifecycle: paid,
        event: { kind: "payment_terminal", state: "failed" },
      })
    );
    expect(regression._tag).toBe("Failure");
  });

  test("does not retry an ambiguous warehouse result until verified", async () => {
    const processing = {
      paymentState: "paid" as const,
      receiptState: "not_started" as const,
      stockState: "processing" as const,
      stockRetryAllowed: false,
    };
    const ambiguous = await Effect.runPromise(
      transitionMobileShopPurchase({
        lifecycle: processing,
        event: { kind: "stock_ambiguous" },
      })
    );
    const retry = await Effect.runPromiseExit(
      transitionMobileShopPurchase({
        lifecycle: ambiguous,
        event: { kind: "stock_claimed" },
      })
    );
    expect(retry._tag).toBe("Failure");

    const verifiedNotApplied = await Effect.runPromise(
      transitionMobileShopPurchase({
        lifecycle: ambiguous,
        event: { kind: "stock_reconciled_not_applied" },
      })
    );
    expect(verifiedNotApplied).toMatchObject({
      stockState: "failed",
      stockRetryAllowed: true,
    });
  });

  test("keeps paid independent from permanent stock failure", async () => {
    const failed = await Effect.runPromise(
      transitionMobileShopPurchase({
        lifecycle: {
          paymentState: "paid",
          receiptState: "sent",
          stockState: "processing",
          stockRetryAllowed: false,
        },
        event: { kind: "stock_failed", retryable: false },
      })
    );
    expect(failed).toEqual({
      paymentState: "paid",
      receiptState: "sent",
      stockState: "failed",
      stockRetryAllowed: false,
    });
  });
});
