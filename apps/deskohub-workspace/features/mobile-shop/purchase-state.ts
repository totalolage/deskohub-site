import { Effect } from "effect";
import type {
  MobileShopPaymentState,
  MobileShopReceiptState,
  MobileShopStockState,
} from "./contracts";
import { MobileShopFailure } from "./errors";

export interface MobileShopPurchaseLifecycle {
  readonly paymentState: MobileShopPaymentState;
  readonly receiptState: MobileShopReceiptState;
  readonly stockState: MobileShopStockState;
  /** True only after a definitive, verified pre-application failure. */
  readonly stockRetryAllowed: boolean;
}

export type MobileShopLifecycleEvent =
  | { readonly kind: "payment_started" }
  | { readonly kind: "payment_paid" }
  | {
      readonly kind: "payment_terminal";
      readonly state: "failed" | "cancelled" | "expired";
    }
  | { readonly kind: "receipt_claimed" }
  | { readonly kind: "receipt_sent" }
  | { readonly kind: "receipt_failed" }
  | { readonly kind: "stock_claimed" }
  | { readonly kind: "stock_synced" }
  | { readonly kind: "stock_ambiguous" }
  | { readonly kind: "stock_failed"; readonly retryable: boolean }
  | { readonly kind: "stock_reconciled_synced" }
  | { readonly kind: "stock_reconciled_not_applied" };

export const initialMobileShopPurchaseLifecycle =
  (): MobileShopPurchaseLifecycle => ({
    paymentState: "not_started",
    receiptState: "not_started",
    stockState: "not_started",
    stockRetryAllowed: false,
  });

export const transitionMobileShopPurchase = Effect.fn(
  "mobileShop.transitionPurchase"
)(function* (input: {
  readonly lifecycle: MobileShopPurchaseLifecycle;
  readonly event: MobileShopLifecycleEvent;
}) {
  const { event, lifecycle } = input;

  switch (event.kind) {
    case "payment_started":
      if (lifecycle.paymentState === "pending") return lifecycle;
      if (lifecycle.paymentState !== "not_started") return yield* invalid();
      return { ...lifecycle, paymentState: "pending" };

    case "payment_paid":
      if (lifecycle.paymentState === "paid") return lifecycle;
      if (lifecycle.paymentState !== "pending") return yield* invalid();
      return { ...lifecycle, paymentState: "paid" };

    case "payment_terminal":
      if (lifecycle.paymentState === event.state) return lifecycle;
      if (lifecycle.paymentState !== "pending") return yield* invalid();
      return { ...lifecycle, paymentState: event.state };

    case "receipt_claimed":
      if (
        lifecycle.paymentState !== "paid" ||
        !["not_started", "failed"].includes(lifecycle.receiptState)
      ) {
        return yield* invalid();
      }
      return { ...lifecycle, receiptState: "processing" };

    case "receipt_sent":
      if (lifecycle.receiptState === "sent") return lifecycle;
      if (
        lifecycle.paymentState !== "paid" ||
        lifecycle.receiptState !== "processing"
      ) {
        return yield* invalid();
      }
      return { ...lifecycle, receiptState: "sent" };

    case "receipt_failed":
      if (
        lifecycle.paymentState !== "paid" ||
        lifecycle.receiptState !== "processing"
      ) {
        return yield* invalid();
      }
      return { ...lifecycle, receiptState: "failed" };

    case "stock_claimed":
      if (
        lifecycle.paymentState !== "paid" ||
        !(
          lifecycle.stockState === "not_started" ||
          (lifecycle.stockState === "failed" &&
            lifecycle.stockRetryAllowed === true)
        )
      ) {
        return yield* invalid();
      }
      return {
        ...lifecycle,
        stockState: "processing",
        stockRetryAllowed: false,
      };

    case "stock_synced":
      if (lifecycle.stockState === "synced") return lifecycle;
      if (
        lifecycle.paymentState !== "paid" ||
        lifecycle.stockState !== "processing"
      ) {
        return yield* invalid();
      }
      return {
        ...lifecycle,
        stockState: "synced",
        stockRetryAllowed: false,
      };

    case "stock_ambiguous":
      if (
        lifecycle.paymentState !== "paid" ||
        lifecycle.stockState !== "processing"
      ) {
        return yield* invalid();
      }
      return {
        ...lifecycle,
        stockState: "ambiguous",
        stockRetryAllowed: false,
      };

    case "stock_failed":
      if (
        lifecycle.paymentState !== "paid" ||
        lifecycle.stockState !== "processing"
      ) {
        return yield* invalid();
      }
      return {
        ...lifecycle,
        stockState: "failed",
        stockRetryAllowed: event.retryable,
      };

    case "stock_reconciled_synced":
      if (lifecycle.stockState === "synced") return lifecycle;
      if (
        lifecycle.paymentState !== "paid" ||
        lifecycle.stockState !== "ambiguous"
      ) {
        return yield* invalid();
      }
      return {
        ...lifecycle,
        stockState: "synced",
        stockRetryAllowed: false,
      };

    case "stock_reconciled_not_applied":
      if (
        lifecycle.paymentState !== "paid" ||
        lifecycle.stockState !== "ambiguous"
      ) {
        return yield* invalid();
      }
      return {
        ...lifecycle,
        stockState: "failed",
        stockRetryAllowed: true,
      };
  }
});

const invalid = () => new MobileShopFailure({ code: "service_unavailable" });
