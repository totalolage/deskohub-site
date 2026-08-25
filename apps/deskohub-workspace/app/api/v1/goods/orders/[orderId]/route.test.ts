import { describe, expect, mock, test } from "bun:test";
import { DotyposCustomerIdSchema } from "@deskohub/dotypos";
import { Effect, Layer } from "effect";
import { CustomerAccountResolver } from "@/features/account";
import { customerAccountIdSchema } from "@/features/account/customer-account";
import { ProviderPaymentFinalizationService } from "@/features/checkout/backend/payment/provider-payment-finalization.service";
import {
  GoodsOrderNotFoundError,
  GoodsOrderService,
} from "@/features/goods/backend";
import { orderIdSchema } from "@/features/order";
import { makeGoodsOrderRoute } from "./route";

const account = {
  accountId: customerAccountIdSchema.make("account-1"),
  dotyposCustomerId: DotyposCustomerIdSchema.make("customer-1"),
};

describe("goods order detail route", () => {
  test("returns 404 when the order is not owned by the authenticated customer", async () => {
    const requestedOrderId = orderIdSchema.make("order-1");
    const GET = makeGoodsOrderRoute(
      Layer.mergeAll(
        Layer.mock(CustomerAccountResolver, {
          resolve: () => Effect.succeed(account),
        }),
        Layer.mock(GoodsOrderService, {
          get: () =>
            Effect.fail(
              new GoodsOrderNotFoundError({ orderId: requestedOrderId })
            ),
        }),
        Layer.mock(ProviderPaymentFinalizationService, {})
      )
    );

    const response = await GET(
      new Request("https://workspace.test/api/v1/goods/orders/order-1"),
      { params: Promise.resolve({ orderId: "order-1" }) }
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "Goods order was not found.",
    });
  });

  for (const paymentState of [
    "pending",
    "failed",
    "cancelled",
    "expired",
  ] as const) {
    test(`reconciles an owned ${paymentState} order on the Nexi return`, async () => {
      const requestedOrderId = orderIdSchema.make("order-1");
      const beforeReturn = { id: requestedOrderId, paymentState } as never;
      const paid = { ...beforeReturn, paymentState: "paid" as const };
      const get = mock(() =>
        Effect.succeed(get.mock.calls.length === 1 ? beforeReturn : paid)
      );
      const finalizePendingProviderPayment = mock(() => Effect.succeed("paid"));
      const GET = makeGoodsOrderRoute(
        Layer.mergeAll(
          Layer.mock(CustomerAccountResolver, {
            resolve: () => Effect.succeed(account),
          }),
          Layer.mock(GoodsOrderService, { get }),
          Layer.mock(ProviderPaymentFinalizationService, {
            finalizePendingProviderPayment,
          })
        )
      );

      const response = await GET(
        new Request(
          "https://workspace.test/api/v1/goods/orders/order-1?paymentOutcome=completed"
        ),
        { params: Promise.resolve({ orderId: "order-1" }) }
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ paymentState: "paid" });
      expect(finalizePendingProviderPayment).toHaveBeenCalledWith({
        orderId: requestedOrderId,
      });
      expect(get).toHaveBeenCalledTimes(2);
    });
  }
});
