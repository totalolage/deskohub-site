import "@/shared/testing/workspace-test-env";

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { Context, Duration, Effect, Layer } from "effect";
import { env } from "@/env";

const reconcileCalls: { readonly limit: number }[] = [];

interface IFakePaymentRefunds {
  readonly reconcileRefunds: (input: {
    readonly limit: number;
  }) => Effect.Effect<
    { checked: number; recorded: number; failed: number },
    Error
  >;
}

const FakePaymentRefundService = Context.Service<
  FakePaymentRefundService,
  IFakePaymentRefunds
>()("@test/FakePaymentRefundService");

const fakePaymentRefundLayer = Layer.succeed(FakePaymentRefundService, {
  reconcileRefunds: (input) => {
    reconcileCalls.push(input);
    return Effect.succeed({ checked: 3, recorded: 1, failed: 0 });
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
    refundBatchOverrunWorstCase: Duration.seconds(35),
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
  });

  test("reconciles one batch sized to re-check recent payments daily", async () => {
    const { GET } = await loadRoute();
    const response = await GET(
      new Request(requestUrl, {
        headers: {
          authorization: `Bearer ${env.CRON_SECRET}`,
        },
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      checked: 3,
      recorded: 1,
      failed: 0,
    });
    expect(reconcileCalls).toEqual([
      {
        limit: 150,
        // 300 s maxDuration - 35 s overrun - 25 s headroom.
        budget: Duration.millis(240_000),
        worstCaseLookupDuration: expect.anything(),
      },
    ]);
  });
});
