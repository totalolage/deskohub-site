import "@/shared/testing/workspace-test-env";

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { Context, Effect, Layer } from "effect";

process.env.CRON_SECRET = "cron-secret-for-payment-refund-test";

const reconcileCalls: { readonly limit: number }[] = [];

interface IFakePaymentRefunds {
  readonly reconcileAwaitingRefunds: (input: {
    readonly limit: number;
  }) => Effect.Effect<
    { checked: number; recorded: number; failed: number },
    Error
  >;
}

let failReconciliation = false;

const FakePaymentRefundService = Context.Service<
  FakePaymentRefundService,
  IFakePaymentRefunds
>()("@test/FakePaymentRefundService");

const fakePaymentRefundLayer = Layer.succeed(FakePaymentRefundService, {
  reconcileAwaitingRefunds: (input) => {
    reconcileCalls.push(input);
    return failReconciliation
      ? Effect.fail(new Error("refund reconciliation unavailable"))
      : Effect.succeed({ checked: 3, recorded: 1, failed: 0 });
  },
}) as Layer.Layer<FakePaymentRefundService>;

Object.assign(FakePaymentRefundService, {
  Default: fakePaymentRefundLayer,
  Live: fakePaymentRefundLayer,
});

mock.module(
  "@/features/checkout/backend/payment/payment-refund.service",
  () => ({
    PaymentRefundService: FakePaymentRefundService,
  })
);

const requestUrl = "https://workspace.test/api/cron/workspace/payment-refunds";

const loadRoute = async () =>
  (await import("./route")) as {
    GET: (request: Request) => Promise<Response>;
  };

describe("payment refund reconciliation cron route", () => {
  beforeEach(() => {
    reconcileCalls.length = 0;
    failReconciliation = false;
  });

  test("rejects requests without the cron secret", async () => {
    const { GET } = await loadRoute();
    const response = await GET(new Request(requestUrl));

    expect(response.status).toBe(401);
    expect(reconcileCalls).toHaveLength(0);
  });

  test("reconciles a bounded batch of attempts awaiting a refund", async () => {
    const { GET } = await loadRoute();
    const response = await GET(
      new Request(requestUrl, {
        headers: {
          authorization: "Bearer cron-secret-for-payment-refund-test",
        },
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      checked: 3,
      recorded: 1,
      failed: 0,
    });
    expect(reconcileCalls).toEqual([{ limit: 25 }]);
  });

  test("returns a 500 response when the batch cannot be read", async () => {
    failReconciliation = true;
    const { GET } = await loadRoute();
    const response = await GET(
      new Request(requestUrl, {
        headers: {
          authorization: "Bearer cron-secret-for-payment-refund-test",
        },
      })
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "Payment refund reconciliation failed",
    });
  });
});
