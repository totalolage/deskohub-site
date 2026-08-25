import { describe, expect, mock, test } from "bun:test";
import { DotyposCustomerIdSchema } from "@deskohub/dotypos";
import { Effect, Layer } from "effect";
import { CustomerAccountResolver } from "@/features/account";
import { customerAccountIdSchema } from "@/features/account/customer-account";
import {
  GoodsOrderNotFoundError,
  GoodsPaymentConflictError,
  GoodsPaymentService,
  GoodsPaymentUnavailableError,
} from "@/features/goods/backend";
import { orderIdSchema } from "@/features/order";
import { makeGoodsPaymentRoute } from "./route";

const account = {
  accountId: customerAccountIdSchema.make("account-1"),
  dotyposCustomerId: DotyposCustomerIdSchema.make("customer-1"),
};
const orderId = orderIdSchema.make("order-1");
const validBody = {
  locale: "en-US",
  billing: { purpose: "personal", invoice: "none" },
};

const makeRoute = (startOrResume: ReturnType<typeof mock>) =>
  makeGoodsPaymentRoute(
    Layer.merge(
      Layer.mock(CustomerAccountResolver, {
        resolve: () => Effect.succeed(account),
      }),
      Layer.mock(GoodsPaymentService, { startOrResume })
    )
  );

const request = <T>(body: T) =>
  new Request("https://workspace.test/api/v1/goods/orders/order-1/payment", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

const context = { params: Promise.resolve({ orderId: "order-1" }) };

describe("goods order payment route", () => {
  test("passes only resolved ownership and PII-free billing intent", async () => {
    const startOrResume = mock((input) => {
      expect(input).toEqual({
        customerId: account.dotyposCustomerId,
        orderId,
        ...validBody,
      });
      return Effect.succeed({ status: "in_progress" as const });
    });
    const POST = makeRoute(startOrResume);

    const response = await POST(request(validBody), context);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "in_progress" });
    expect(startOrResume).toHaveBeenCalledTimes(1);
  });

  test("rejects client-authored payment and customer facts", async () => {
    const startOrResume = mock(() =>
      Effect.succeed({ status: "in_progress" as const })
    );
    const POST = makeRoute(startOrResume);

    const response = await POST(
      request({
        ...validBody,
        customerId: "another-customer",
        amount: { value: 1, exponent: 2, currency: "CZK" },
        lines: [],
      }),
      context
    );

    expect(response.status).toBe(400);
    expect(startOrResume).not.toHaveBeenCalled();
  });

  test("hides an ownership mismatch as not found", async () => {
    const startOrResume = mock(() =>
      Effect.fail(new GoodsOrderNotFoundError({ orderId }))
    );
    const POST = makeRoute(startOrResume);

    const response = await POST(request(validBody), context);

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ status: "not_found" });
  });

  test("maps internal state and dependency failures to safe unions", async () => {
    for (const scenario of [
      {
        error: new GoodsPaymentConflictError({ cause: "synthetic" }),
        statusCode: 409,
        body: { status: "conflict" },
      },
      {
        error: new GoodsPaymentUnavailableError({ cause: "synthetic" }),
        statusCode: 503,
        body: { status: "unavailable" },
      },
    ]) {
      const POST = makeRoute(mock(() => Effect.fail(scenario.error)));
      const response = await POST(request(validBody), context);
      expect(response.status).toBe(scenario.statusCode);
      await expect(response.json()).resolves.toEqual(scenario.body);
    }
  });
});
