import { describe, expect, test } from "bun:test";
import { DotyposCustomerIdSchema } from "@deskohub/dotypos";
import { Effect, Layer, Schema } from "effect";
import { TestClock } from "effect/testing";
import {
  goodsOrderDetailSchema,
  goodsOrderIssuanceFactsSchema,
} from "../goods-order";
import { GoodsOrderRepository } from "./goods-order.repository";
import { GoodsOrderService } from "./goods-order.service";

const customerId = DotyposCustomerIdSchema.make("customer-1");
const facts = Schema.decodeUnknownSync(goodsOrderIssuanceFactsSchema)({
  issuanceId: "018f1e36-7a31-7c07-90f4-8f2531cd1212",
  expectedCart: {
    revision: 3,
    items: [{ productId: "product-1", quantity: 2 }],
  },
  lines: [
    {
      product: {
        kind: "goods",
        categoryId: "category-1",
        productId: "product-1",
      },
      description: "Sparkling water",
      quantity: 2,
      unitPrice: { value: 4500, exponent: 2, currency: "CZK" },
      undiscountedTotal: { value: 9000, exponent: 2, currency: "CZK" },
      payableTotal: { value: 9000, exponent: 2, currency: "CZK" },
    },
  ],
  locale: "en-US",
  legalDocuments: [
    {
      documentKey: "termsAndConditions",
      document: {
        path: "/en-US/terms-and-conditions",
        hash: "terms-hash",
        hashAlgorithm: "sha256",
      },
    },
  ],
});
const detail = Schema.decodeUnknownSync(goodsOrderDetailSchema)({
  id: "order-1",
  paymentState: "not_started",
  fulfillmentState: "fulfilled",
  fulfilledAt: "2026-08-16T20:00:00.000Z",
  createdAt: "2026-08-16T20:00:00.000Z",
  undiscountedTotal: { value: 9000, exponent: 2, currency: "CZK" },
  payableTotal: { value: 9000, exponent: 2, currency: "CZK" },
  lines: facts.lines,
});

describe("GoodsOrderService", () => {
  test("adds one server timestamp to already-validated issuance facts", async () => {
    const calls: unknown[] = [];
    const layer = Layer.mergeAll(
      GoodsOrderService.Default.pipe(
        Layer.provide(
          Layer.mock(GoodsOrderRepository, {
            issue: (input) => {
              calls.push(input);
              return Effect.succeed(detail);
            },
          })
        )
      ),
      TestClock.layer()
    );

    const result = await Effect.gen(function* () {
      yield* TestClock.setTime(
        Temporal.Instant.from("2026-08-16T20:00:00.000Z").epochMilliseconds
      );
      const orders = yield* GoodsOrderService;
      return yield* orders.issue({ ...facts, customerId });
    }).pipe(Effect.provide(layer), Effect.runPromise);

    expect(result).toEqual(detail);
    expect(calls).toEqual([
      {
        ...facts,
        customerId: "customer-1",
        issuedAt: Temporal.Instant.from("2026-08-16T20:00:00.000Z"),
      },
    ]);
  });
});
