import { describe, expect, test } from "bun:test";
import {
  DotyposCustomerIdSchema,
  DotyposProductIdSchema,
} from "@deskohub/dotypos";
import { Effect, Layer, Schema } from "effect";
import { CustomerAccountResolver } from "@/features/account";
import {
  CustomerAccountAccessError,
  customerAccountIdSchema,
} from "@/features/account/customer-account";
import {
  GoodsCartRevisionConflict,
  GoodsCartService,
} from "@/features/goods/backend";
import { makeGoodsCartRoutes } from "./route";

const account = {
  accountId: Schema.decodeUnknownSync(customerAccountIdSchema)("account-id"),
  dotyposCustomerId: Schema.decodeUnknownSync(DotyposCustomerIdSchema)(
    "customer-id"
  ),
};
const productId = Schema.decodeUnknownSync(DotyposProductIdSchema)(
  "product-id"
);
const cart = { revision: 1, items: [{ productId, quantity: 2 }] };

describe("goods cart route", () => {
  test("passes only the resolved Dotypos customer into cart operations", async () => {
    const calls: unknown[] = [];
    const routes = makeGoodsCartRoutes(
      Layer.merge(
        Layer.mock(CustomerAccountResolver, {
          resolve: () => Effect.succeed(account),
        }),
        Layer.mock(GoodsCartService, {
          get: (customerId) => {
            calls.push(["get", customerId]);
            return Effect.succeed(cart);
          },
          setItem: (customerId, input) => {
            calls.push(["set", customerId, input]);
            return Effect.succeed(cart);
          },
          removeItem: (customerId, input) => {
            calls.push(["remove", customerId, input]);
            return Effect.succeed(cart);
          },
        })
      )
    );

    const getResponse = await routes.GET(
      new Request("https://workspace.test/api/v1/goods/cart")
    );
    const putResponse = await routes.PUT(
      jsonRequest("PUT", {
        expectedRevision: 0,
        productId: "product-id",
        quantity: 2,
      })
    );
    const deleteResponse = await routes.DELETE(
      jsonRequest("DELETE", {
        expectedRevision: 1,
        productId: "product-id",
      })
    );

    for (const response of [getResponse, putResponse, deleteResponse]) {
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      await expect(response.json()).resolves.toEqual(cart);
    }
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

  test("returns the current cart for revision conflicts", async () => {
    const routes = makeGoodsCartRoutes(
      Layer.merge(
        Layer.mock(CustomerAccountResolver, {
          resolve: () => Effect.succeed(account),
        }),
        Layer.mock(GoodsCartService, {
          setItem: () =>
            Effect.fail(new GoodsCartRevisionConflict({ current: cart })),
        })
      )
    );

    const response = await routes.PUT(
      jsonRequest("PUT", {
        expectedRevision: 0,
        productId: "product-id",
        quantity: 2,
      })
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "Cart changed on another request.",
      cart,
    });
  });

  test("rejects unauthenticated access before reading a cart", async () => {
    let cartReads = 0;
    const routes = makeGoodsCartRoutes(
      Layer.merge(
        Layer.mock(CustomerAccountResolver, {
          resolve: () =>
            Effect.fail(
              new CustomerAccountAccessError({ reason: "unauthenticated" })
            ),
        }),
        Layer.mock(GoodsCartService, {
          get: () => {
            cartReads += 1;
            return Effect.succeed(cart);
          },
        })
      )
    );

    const response = await routes.GET(
      new Request("https://workspace.test/api/v1/goods/cart")
    );

    expect(response.status).toBe(401);
    expect(cartReads).toBe(0);
  });
});

type CartRequestBody =
  | {
      readonly expectedRevision: number;
      readonly productId: string;
    }
  | {
      readonly expectedRevision: number;
      readonly productId: string;
      readonly quantity: number;
    };

const jsonRequest = (method: "DELETE" | "PUT", body: CartRequestBody) =>
  new Request("https://workspace.test/api/v1/goods/cart", {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
