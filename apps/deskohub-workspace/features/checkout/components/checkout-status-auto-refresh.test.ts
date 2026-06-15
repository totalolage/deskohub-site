import { describe, expect, test } from "bun:test";
import { shouldAutoRefreshCheckoutStatus } from "@/features/checkout/checkout-status-refresh-policy";

describe("shouldAutoRefreshCheckoutStatus", () => {
  test("refreshes while payment or access-code delivery is still pending", () => {
    expect(shouldAutoRefreshCheckoutStatus("pending")).toBe(true);
    expect(shouldAutoRefreshCheckoutStatus("paid_waiting_fulfillment")).toBe(
      true
    );
  });

  test("stops refreshing once the checkout reaches a terminal status", () => {
    expect(shouldAutoRefreshCheckoutStatus("fulfilled")).toBe(false);
    expect(shouldAutoRefreshCheckoutStatus("fulfillment_failed")).toBe(false);
    expect(shouldAutoRefreshCheckoutStatus("payment_failed")).toBe(false);
    expect(shouldAutoRefreshCheckoutStatus("cancelled")).toBe(false);
    expect(shouldAutoRefreshCheckoutStatus("expired")).toBe(false);
    expect(shouldAutoRefreshCheckoutStatus("not_found")).toBe(false);
  });
});
