import { describe, expect, test } from "bun:test";
import { getPublicCatalogOfferings } from "@/features/checkout/public-offerings";
import { locales } from "@/features/i18n";
import { formatMoney, moneyMajorAmount } from "@/shared/money/money";
import { getCatalogPriceRange } from "./price-range";

describe("getCatalogPriceRange", () => {
  for (const locale of locales) {
    test(`spans the cheapest to the dearest catalog product in ${locale}`, () => {
      const prices = getPublicCatalogOfferings({ locale })
        .map(({ price }) => price)
        .sort(
          (left, right) => moneyMajorAmount(left) - moneyMajorAmount(right)
        );
      const cheapest = prices[0];
      const dearest = prices[prices.length - 1];
      if (!cheapest || !dearest) throw new Error("The catalog is empty.");

      expect(getCatalogPriceRange(locale)).toBe(
        `${formatMoney(cheapest, locale)} – ${formatMoney(dearest, locale)}`
      );
      expect(moneyMajorAmount(cheapest)).toBeLessThan(
        moneyMajorAmount(dearest)
      );
    });
  }
});
