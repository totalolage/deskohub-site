import { describe, expect, test } from "bun:test";
import { DotyposCustomerIdSchema } from "@deskohub/dotypos";
import { Effect, Layer, Schema } from "effect";
import { CustomerAccountResolver } from "@/features/account";
import { customerAccountIdSchema } from "@/features/account/customer-account";
import { goodsOrderSummarySchema } from "@/features/goods";
import { GoodsOrderService } from "@/features/goods/backend";
import { makeGoodsOrdersRoute } from "./route";

const account = {
  accountId: customerAccountIdSchema.make("account-1"),
  dotyposCustomerId: DotyposCustomerIdSchema.make("customer-1"),
};
const summary = Schema.decodeUnknownSync(goodsOrderSummarySchema)({
  id: "order-1",
  paymentState: "not_started",
  fulfillmentState: "fulfilled",
  fulfilledAt: "2026-08-16T20:00:00.000Z",
  createdAt: "2026-08-16T20:00:00.000Z",
  undiscountedTotal: { value: 9000, exponent: 2, currency: "CZK" },
  payableTotal: { value: 9000, exponent: 2, currency: "CZK" },
});

describe("goods orders route", () => {
  test("lists only the authenticated customer's safe order projection", async () => {
    const customers: string[] = [];
    const GET = makeGoodsOrdersRoute(
      Layer.merge(
        Layer.mock(CustomerAccountResolver, {
          resolve: () => Effect.succeed(account),
        }),
        Layer.mock(GoodsOrderService, {
          list: (customerId) => {
            customers.push(customerId);
            return Effect.succeed([summary]);
          },
        })
      )
    );

    const response = await GET(
      new Request("https://workspace.test/api/v1/goods/orders")
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual([summary]);
    expect(customers).toEqual(["customer-1"]);
    expect(JSON.stringify(summary)).not.toContain("customer-1");
  });
});
