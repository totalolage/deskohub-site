import { describe, expect, test } from "bun:test";
import { createMobileShopHistoryPage } from "./mobile-shop.service";

describe("mobile shop purchase history", () => {
  test("returns a cursor when more purchases remain", () => {
    const orders = Array.from({ length: 21 }, (_, index) => ({
      id: `purchase-${String(21 - index).padStart(2, "0")}`,
      createdAt: `2026-08-${String(31 - index).padStart(2, "0")}T12:00:00Z`,
    }));

    expect(createMobileShopHistoryPage(orders, 20)).toEqual({
      orders: orders.slice(0, 20),
      nextCursor: JSON.stringify([orders[19]?.createdAt, orders[19]?.id]),
    });
  });
});
