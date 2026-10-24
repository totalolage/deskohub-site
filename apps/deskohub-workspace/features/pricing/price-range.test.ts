import { describe, expect, test } from "bun:test";
import { getPublicCatalogOfferings } from "@/features/checkout/public-offerings";
import {
  formatWorkspaceMoney,
  toWorkspaceMoneyMajorAmount,
} from "@/features/checkout/workspace-money";
import { locales } from "@/features/i18n";
import { getCatalogPriceRange } from "./price-range";

describe("getCatalogPriceRange", () => {
  for (const locale of locales) {
    test(`spans the cheapest to the dearest catalog product in ${locale}`, () => {
      const prices = getPublicCatalogOfferings({ locale })
        .map(({ price }) => price)
        .sort(
          (left, right) =>
            toWorkspaceMoneyMajorAmount(left) -
            toWorkspaceMoneyMajorAmount(right)
        );
      const cheapest = prices[0];
      const dearest = prices[prices.length - 1];
      if (!cheapest || !dearest) throw new Error("The catalog is empty.");

      expect(getCatalogPriceRange(locale)).toBe(
        `${formatWorkspaceMoney(cheapest, locale)} – ${formatWorkspaceMoney(dearest, locale)}`
      );
      expect(toWorkspaceMoneyMajorAmount(cheapest)).toBeLessThan(
        toWorkspaceMoneyMajorAmount(dearest)
      );
    });
  }
});
