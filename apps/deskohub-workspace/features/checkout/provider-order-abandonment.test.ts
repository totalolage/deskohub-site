import { describe, expect, test } from "bun:test";
import "@/shared/polyfills/temporal";
import {
  getProviderOrderAbandonmentCutoff,
  getProviderOrderAbandonmentState,
  hasProviderPaymentActivity,
} from "./provider-order-abandonment";

const providerOrderCreatedAt = Temporal.Instant.from(
  "2026-08-01T10:00:00.000Z"
);
const emptyOrder = { operationCount: 0 };

describe("getProviderOrderAbandonmentState", () => {
  test("defers an empty order until the cutoff", () => {
    expect(
      getProviderOrderAbandonmentState({
        checkedAt: providerOrderCreatedAt.add({ minutes: 29, seconds: 59 }),
        providerOrderCreatedAt,
        order: emptyOrder,
      })
    ).toBe("deferred");
  });

  test("abandons an empty order from the cutoff on", () => {
    expect(
      getProviderOrderAbandonmentState({
        checkedAt: getProviderOrderAbandonmentCutoff(providerOrderCreatedAt),
        providerOrderCreatedAt,
        order: emptyOrder,
      })
    ).toBe("abandoned");
  });

  test("never abandons an order with payment activity", () => {
    for (const order of [
      { operationCount: 1 },
      { operationCount: 0, authorizedAmount: "1" },
      { operationCount: 0, capturedAmount: "0.01" },
    ]) {
      expect(
        getProviderOrderAbandonmentState({
          checkedAt: providerOrderCreatedAt.add({ hours: 1 }),
          providerOrderCreatedAt,
          order,
        })
      ).toBe("not_empty");
    }
  });

  test("does not decide without a check time or provider order time", () => {
    expect(
      getProviderOrderAbandonmentState({
        checkedAt: undefined,
        providerOrderCreatedAt,
        order: emptyOrder,
      })
    ).toBe("not_empty");
    expect(
      getProviderOrderAbandonmentState({
        checkedAt: providerOrderCreatedAt.add({ hours: 1 }),
        providerOrderCreatedAt: null,
        order: emptyOrder,
      })
    ).toBe("not_empty");
  });
});

describe("hasProviderPaymentActivity", () => {
  test("treats zero-valued amounts as no activity", () => {
    for (const amount of ["0", "00", "0.00", " 0 "]) {
      expect(
        hasProviderPaymentActivity({
          operationCount: 0,
          authorizedAmount: amount,
          capturedAmount: amount,
        })
      ).toBe(false);
    }
  });
});
