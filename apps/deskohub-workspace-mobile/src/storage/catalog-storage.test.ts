import { describe, expect, test } from "bun:test";
import type { Catalog } from "@/src/domain/shop";
import { createCatalogStorage } from "./catalog-storage";
import type { DeviceStorage } from "./device-storage";

const catalog: Catalog = {
  refreshedAt: "2026-08-11T20:00:00Z",
  categories: [{ id: "drinks", name: { cs: "Nápoje", en: "Drinks" } }],
  products: [
    {
      id: "water",
      categoryId: "drinks",
      name: { cs: "Voda", en: "Water" },
      description: { cs: "500 ml", en: "500 ml" },
      imageUrl: "https://images.example/water.png",
      price: { currency: "CZK", minorUnits: 3900 },
      color: "aqua",
      initials: "V",
    },
  ],
};

describe("catalog storage", () => {
  test("keeps the last valid catalog independently for each locale", async () => {
    const storage = memoryStorage();
    const catalogs = createCatalogStorage(storage);

    await catalogs.save("cs", catalog);

    expect(await catalogs.load("cs")).toEqual(catalog);
    expect(await catalogs.load("en")).toBeNull();
  });

  test("rejects malformed or non-HTTPS cached catalog data", async () => {
    const storage = memoryStorage();
    await storage.setItem(
      "deskohub-workspace:shop-catalog:v1:en",
      JSON.stringify({
        ...catalog,
        products: [{ ...catalog.products[0], imageUrl: "http://bad.test/x" }],
      })
    );

    expect(await createCatalogStorage(storage).load("en")).toBeNull();
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
