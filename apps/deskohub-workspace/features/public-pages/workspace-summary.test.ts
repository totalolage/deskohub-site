import { describe, expect, test } from "bun:test";
import { getPublicCatalogOfferings } from "@/features/checkout/public-offerings";
import { locales, m } from "@/features/i18n";
import { workspaceSiteConstants } from "@/shared/utils/site-constants";
import { getWorkspaceSummary } from "./workspace-summary";

describe("getWorkspaceSummary", () => {
  test("names the address and each offered product once in every locale", () => {
    const { street, cityDistrict, city, postalCode } =
      workspaceSiteConstants.location.address;

    for (const locale of locales) {
      const offerings = getPublicCatalogOfferings({ locale, office: {} });
      const summary = getWorkspaceSummary({ locale, offerings });

      for (const field of [street, cityDistrict, city, postalCode]) {
        expect(summary).toContain(field);
      }
      for (const name of new Set(offerings.map(({ name }) => name))) {
        expect(summary.split(name)).toHaveLength(2);
      }
    }
  });

  test("adds the always-open statement only while the space is always open", () => {
    for (const locale of locales) {
      const offerings = getPublicCatalogOfferings({ locale });
      const alwaysOpen = getWorkspaceSummary({
        locale,
        offerings,
        openingHours: { alwaysOpen: true },
      });
      const limited = getWorkspaceSummary({
        locale,
        offerings,
        openingHours: { alwaysOpen: false },
      });

      const statement = m.workspaceMetadataAlwaysOpen({}, { locale });

      expect(alwaysOpen).toContain(statement);
      expect(limited).not.toContain(statement);
      expect(alwaysOpen).toStartWith(limited);
      expect(getWorkspaceSummary({ locale, offerings })).toBe(
        workspaceSiteConstants.openingHours.alwaysOpen ? alwaysOpen : limited
      );
    }
  });
});
