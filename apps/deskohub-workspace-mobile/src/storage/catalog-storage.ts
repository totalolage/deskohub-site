import type { Catalog, Locale } from "@/src/domain/shop";
import type { DeviceStorage } from "./device-storage";

const CATALOG_KEY_PREFIX = "deskohub-workspace:shop-catalog:v1";
const maximumSerializedCatalogLength = 1_000_000;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isLocalizedText = (value: unknown) =>
  isRecord(value) &&
  typeof value.cs === "string" &&
  typeof value.en === "string";

const isCatalog = (value: unknown): value is Catalog => {
  if (
    !isRecord(value) ||
    typeof value.refreshedAt !== "string" ||
    Number.isNaN(Date.parse(value.refreshedAt)) ||
    !Array.isArray(value.categories) ||
    !Array.isArray(value.products) ||
    value.categories.length > 1_000 ||
    value.products.length > 1_000
  ) {
    return false;
  }

  const categoriesAreValid = value.categories.every(
    (category) =>
      isRecord(category) &&
      typeof category.id === "string" &&
      category.id.length > 0 &&
      isLocalizedText(category.name)
  );
  const productsAreValid = value.products.every(
    (product) =>
      isRecord(product) &&
      typeof product.id === "string" &&
      product.id.length > 0 &&
      typeof product.categoryId === "string" &&
      product.categoryId.length > 0 &&
      isLocalizedText(product.name) &&
      isLocalizedText(product.description) &&
      isRecord(product.price) &&
      product.price.currency === "CZK" &&
      typeof product.price.minorUnits === "number" &&
      Number.isSafeInteger(product.price.minorUnits) &&
      product.price.minorUnits > 0 &&
      (product.imageUrl === undefined ||
        (typeof product.imageUrl === "string" &&
          product.imageUrl.startsWith("https://")))
  );

  return categoriesAreValid && productsAreValid;
};

export interface CatalogStorage {
  load(locale: Locale): Promise<Catalog | null>;
  save(locale: Locale, catalog: Catalog): Promise<void>;
}

export function createCatalogStorage(storage: DeviceStorage): CatalogStorage {
  return {
    async load(locale) {
      const raw = await storage.getItem(`${CATALOG_KEY_PREFIX}:${locale}`);
      if (!raw || raw.length > maximumSerializedCatalogLength) return null;
      try {
        const parsed: unknown = JSON.parse(raw);
        return isCatalog(parsed) ? parsed : null;
      } catch {
        return null;
      }
    },
    save(locale, catalog) {
      return storage.setItem(
        `${CATALOG_KEY_PREFIX}:${locale}`,
        JSON.stringify(catalog)
      );
    },
  };
}
