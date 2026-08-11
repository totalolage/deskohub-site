import { normalizeCart } from "@/src/domain/cart";
import type { CartLine } from "@/src/domain/shop";
import type { DeviceStorage } from "./device-storage";

const CART_KEY = "deskohub-workspace:shop-cart:v1";

function isPersistedCartLine(value: unknown): value is CartLine {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<CartLine>;
  return (
    typeof candidate.productId === "string" &&
    typeof candidate.quantity === "number"
  );
}

export interface CartStorage {
  load(): Promise<readonly CartLine[]>;
  save(lines: readonly CartLine[]): Promise<void>;
  clear(): Promise<void>;
}

export function createCartStorage(storage: DeviceStorage): CartStorage {
  return {
    async load() {
      const raw = await storage.getItem(CART_KEY);
      if (!raw) return [];
      try {
        const parsed: unknown = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return normalizeCart(parsed.filter(isPersistedCartLine));
      } catch {
        return [];
      }
    },
    save(lines) {
      return storage.setItem(CART_KEY, JSON.stringify(normalizeCart(lines)));
    },
    clear() {
      return storage.removeItem(CART_KEY);
    },
  };
}
