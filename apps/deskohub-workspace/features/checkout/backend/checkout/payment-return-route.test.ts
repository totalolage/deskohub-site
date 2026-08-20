import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import { Effect, Layer } from "effect";
import type { ICheckoutStatusService } from "./checkout-status.service";

mock.module("server-only", () => ({}));

const { CheckoutStatusService } = await import("./checkout-status.service");
const { makeCheckoutPaymentReturnGet } = await import(
  "./checkout-payment-return-route.server"
);

const makeStatusServiceLayer = (
  refreshStatus: ICheckoutStatusService["refreshStatus"]
) =>
  Layer.succeed(CheckoutStatusService, {
    getStatus: () => Effect.die("unused"),
    refreshStatus,
  });

const invoke = (refreshStatus: ICheckoutStatusService["refreshStatus"]) => {
  const GET = makeCheckoutPaymentReturnGet(
    makeStatusServiceLayer(refreshStatus)
  );

  return invokeGet(GET);
};

const invokeGet = (
  GET: ReturnType<typeof makeCheckoutPaymentReturnGet>,
  params = { locale: "en-US", orderId: "order-id" }
) =>
  GET(
    new Request(
      "https://deskohub.test/en-US/checkout/pay/return/order-id?outcome=success"
    ),
    { params: Promise.resolve(params) }
  );

describe("checkout pay return route", () => {
  test("refreshes the provider state and redirects to reservation status", async () => {
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
      "/en-US/reservation/status/order-id?outcome=success"
    );
    expect(refreshStatus).toHaveBeenCalledWith({
      orderId: "order-id",
      returnOutcome: "success",
    });
  });

  test("briefly retries while provider settlement is not yet visible", async () => {
    const refreshStatus = mock()
      .mockReturnValueOnce(
        Effect.succeed({
          orderId: "order-id",
          returnOutcome: "success" as const,
          status: "created" as const,
        })
      )
      .mockReturnValueOnce(
        Effect.succeed({
          orderId: "order-id",
          returnOutcome: "success" as const,
          status: "pending" as const,
        })
      )
      .mockReturnValueOnce(
        Effect.succeed({
          orderId: "order-id",
          returnOutcome: "success" as const,
          status: "fulfilled" as const,
        })
      );

    const response = await invoke(refreshStatus);

    expect(response.status).toBe(307);
    expect(refreshStatus).toHaveBeenCalledTimes(3);
  }, 30_000);

  test("preserves the fail-open redirect when refresh fails", async () => {
    const response = await invoke(() => Effect.fail(new Error("unavailable")));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain(
      "/en-US/reservation/status/order-id?outcome=success"
    );
  }, 30_000);

  test("does not hide refresh defects behind the fail-open redirect", async () => {
    const defect = new Error("unexpected defect");

    await expect(invoke(() => Effect.die(defect))).rejects.toBe(defect);
  });

  test("rejects invalid params before acquiring the status service", async () => {
    let acquisitions = 0;
    const GET = makeCheckoutPaymentReturnGet(
      Layer.sync(CheckoutStatusService, () => {
        acquisitions += 1;
        return {
          getStatus: () => Effect.die("unused"),
          refreshStatus: () => Effect.die("unused"),
        };
      })
    );

    const invalidParams = [
      { locale: "en-US", orderId: "" },
      { locale: "sk-SK", orderId: "order-id" },
    ];

    for (const params of invalidParams) {
      const response = await invokeGet(GET, params);
      expect(response.status).toBe(404);
    }
    expect(acquisitions).toBe(0);
  });
});
