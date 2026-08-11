import { describe, expect, test } from "bun:test";

import {
  getCartQuantity,
  getLocalCartTotal,
  MAX_CART_QUANTITY,
  normalizeCart,
  setCartQuantity,
} from "./cart";

describe("cart state", () => {
  test("caps one product at ten and the whole cart at thirty", () => {
    let cart = setCartQuantity([], "water", 20);
    expect(cart).toEqual([{ productId: "water", quantity: 10 }]);

    cart = setCartQuantity(cart, "cola", 10);
    cart = setCartQuantity(cart, "snack", 10);
    cart = setCartQuantity(cart, "coffee", 1);
    expect(getCartQuantity(cart)).toBe(MAX_CART_QUANTITY);
    expect(cart.some((line) => line.productId === "coffee")).toBe(false);
  });

  test("removes zero quantities and normalizes persisted input", () => {
    expect(
      normalizeCart([
        { productId: "water", quantity: 2.9 },
        { productId: "snack", quantity: -1 },
      ])
    ).toEqual([{ productId: "water", quantity: 2 }]);
    expect(
      setCartQuantity([{ productId: "water", quantity: 2 }], "water", 0)
    ).toEqual([]);
  });

  test("local totals are informational and ignore unknown products", () => {
    expect(
      getLocalCartTotal(
        [
          { productId: "water", quantity: 2 },
          { productId: "removed", quantity: 1 },
        ],
        [{ id: "water", price: { minorUnits: 3900 } }]
      )
    ).toBe(7800);
  });
});
