import { describe, expect, test } from "bun:test";
import {
  DotyposCustomerIdSchema,
  DotyposProductIdSchema,
} from "@deskohub/dotypos";
import { Effect, Layer, Schema } from "effect";
import { GoodsCartRepository } from "./goods-cart.repository";
import { GoodsCartService } from "./goods-cart.service";

const customerId = Schema.decodeUnknownSync(DotyposCustomerIdSchema)(
  "customer-id"
);
const productId = Schema.decodeUnknownSync(DotyposProductIdSchema)(
  "product-id"
);

describe("GoodsCartService", () => {
  test("passes only the Dotypos customer and validated cart input", async () => {
    const calls: unknown[] = [];
    const cart = { revision: 1, items: [{ productId, quantity: 2 }] };
    const layer = GoodsCartService.Default.pipe(
      Layer.provide(
        Layer.mock(GoodsCartRepository, {
          get: (requestedCustomerId) => {
            calls.push(["get", requestedCustomerId]);
            return Effect.succeed(cart);
          },
          setItem: (requestedCustomerId, input) => {
            calls.push(["set", requestedCustomerId, input]);
            return Effect.succeed(cart);
          },
          removeItem: (requestedCustomerId, input) => {
            calls.push(["remove", requestedCustomerId, input]);
            return Effect.succeed(cart);
          },
        })
      )
    );

    await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* GoodsCartService;
        yield* service.get(customerId);
        yield* service.setItem(customerId, {
          expectedRevision: 0,
          productId,
          quantity: 2,
        });
        yield* service.removeItem(customerId, {
          expectedRevision: 1,
          productId,
        });
      }).pipe(Effect.provide(layer))
    );

    expect(calls).toEqual([
      ["get", "customer-id"],
      [
        "set",
        "customer-id",
        { expectedRevision: 0, productId: "product-id", quantity: 2 },
      ],
      [
        "remove",
        "customer-id",
        { expectedRevision: 1, productId: "product-id" },
      ],
    ]);
  });
});
