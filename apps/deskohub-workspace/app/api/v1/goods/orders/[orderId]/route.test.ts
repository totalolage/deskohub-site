import { describe, expect, test } from "bun:test";
import { DotyposCustomerIdSchema } from "@deskohub/dotypos";
import { Effect, Layer } from "effect";
import { CustomerAccountResolver } from "@/features/account";
import { customerAccountIdSchema } from "@/features/account/customer-account";
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
      Layer.merge(
        Layer.mock(CustomerAccountResolver, {
          resolve: () => Effect.succeed(account),
        }),
        Layer.mock(GoodsOrderService, {
          get: () =>
            Effect.fail(
              new GoodsOrderNotFoundError({ orderId: requestedOrderId })
            ),
        })
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
});
