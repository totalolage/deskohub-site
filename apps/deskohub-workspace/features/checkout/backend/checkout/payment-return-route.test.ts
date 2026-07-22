import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import { Effect, Layer } from "effect";
import type { CheckoutStatusService as CheckoutStatusServiceType } from "./checkout-status.service";

mock.module("server-only", () => ({}));

const { CheckoutStatusService } = await import("./checkout-status.service");
const { makeCheckoutPaymentReturnGet } = await import(
  "./checkout-payment-return-route.server"
);

const makeStatusServiceLayer = (
  refreshStatus: CheckoutStatusServiceType["refreshStatus"]
) =>
  Layer.succeed(CheckoutStatusService, {
    getStatus: () => Effect.die("unused"),
    refreshStatus,
  });

const invoke = (refreshStatus: CheckoutStatusServiceType["refreshStatus"]) => {
  const GET = makeCheckoutPaymentReturnGet(
    makeStatusServiceLayer(refreshStatus)
  );

  return GET(
    new Request(
      "https://deskohub.test/en-US/checkout/payment/order-id?outcome=success"
    ),
    { params: Promise.resolve({ locale: "en-US", orderId: "order-id" }) }
  );
};

describe("checkout payment return route", () => {
  test("refreshes the provider state and redirects to status", async () => {
    const refreshStatus = mock(() =>
      Effect.succeed({
        orderId: "order-id",
        returnOutcome: "success" as const,
        status: "fulfilled" as const,
      })
    );

    const response = await invoke(refreshStatus);

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain(
      "/en-US/checkout/status/order-id?outcome=success"
    );
    expect(refreshStatus).toHaveBeenCalledWith({
      orderId: "order-id",
      returnOutcome: "success",
    });
  });

  test("preserves the fail-open redirect when refresh fails", async () => {
    const response = await invoke(() => Effect.fail(new Error("unavailable")));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain(
      "/en-US/checkout/status/order-id?outcome=success"
    );
  });

  test("does not hide refresh defects behind the fail-open redirect", async () => {
    const defect = new Error("unexpected defect");

    await expect(invoke(() => Effect.die(defect))).rejects.toBe(defect);
  });
});
