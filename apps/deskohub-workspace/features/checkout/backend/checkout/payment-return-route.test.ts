import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import { Effect, Layer } from "effect";
import type { ICheckoutStatusService } from "./checkout-status.service";

mock.module("server-only", () => ({}));

let requestCookie: string | undefined;
mock.module("next/headers", () => ({
  cookies: async () => ({
    get: () => (requestCookie ? { value: requestCookie } : undefined),
  }),
  headers: async () => new Headers(),
}));

const { CheckoutStatusService } = await import("./checkout-status.service");
const { makeCheckoutPaymentReturnGet } = await import(
  "./checkout-payment-return-route.server"
);
const { ReservationAuthorizationService } = await import(
  "@/features/reservation/backend/reservation-authorization.service"
);

const makeStatusServiceLayer = (
  refreshStatus: ICheckoutStatusService["refreshStatus"]
) =>
  Layer.succeed(CheckoutStatusService, {
    getStatus: () => Effect.die("unused"),
    refreshStatus,
  });

const makeAuthorizationServiceLayer = (isAuthorized: ReturnType<typeof mock>) =>
  Layer.succeed(ReservationAuthorizationService, {
    isAuthorized,
  });

const invoke = (
  refreshStatus: ICheckoutStatusService["refreshStatus"],
  isAuthorized = mock(() => Effect.succeed(true))
) => {
  const GET = makeCheckoutPaymentReturnGet(
    makeStatusServiceLayer(refreshStatus),
    makeAuthorizationServiceLayer(isAuthorized)
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
  test("authorizes from the reservation access cookie before refreshing", async () => {
    requestCookie = "reservation-access-cookie";
    const isAuthorized = mock(() => Effect.succeed(true));
    const refreshStatus = mock(() =>
      Effect.succeed({
        orderId: "order-id",
        returnOutcome: "success" as const,
        status: "fulfilled" as const,
      })
    );

    await invoke(refreshStatus, isAuthorized);

    expect(isAuthorized).toHaveBeenCalledWith({
      accessCookie: requestCookie,
      locale: "en-US",
      orderId: "order-id",
    });
    requestCookie = undefined;
  });

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
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
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

  test("does not refresh or redirect when reservation access is unauthorized", async () => {
    const refreshStatus = mock(() =>
      Effect.fail(new Error("must not refresh"))
    );
    const isAuthorized = mock(() => Effect.succeed(false));

    const response = await invoke(refreshStatus, isAuthorized);

    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(refreshStatus).not.toHaveBeenCalled();
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
      }),
      makeAuthorizationServiceLayer(mock(() => Effect.die("unused")))
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
