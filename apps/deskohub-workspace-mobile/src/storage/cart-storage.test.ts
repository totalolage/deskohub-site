import { describe, expect, test } from "bun:test";
import { createCartStorage } from "./cart-storage";
import type { DeviceStorage } from "./device-storage";

describe("cart storage", () => {
  test("does not restore carts written against the removed demo catalog", async () => {
    const storage = memoryStorage();
    await storage.setItem(
      "deskohub-workspace:shop-cart:v1",
      JSON.stringify([{ productId: "water", quantity: 2 }])
    );

    expect(await createCartStorage(storage).load()).toEqual([]);
  });
});

const memoryStorage = (): DeviceStorage => {
  const values = new Map<string, string>();
  return {
    getItem: async (key) => values.get(key) ?? null,
    setItem: async (key, value) => {
      values.set(key, value);
    },
    removeItem: async (key) => {
      values.delete(key);
    },
  };
};
