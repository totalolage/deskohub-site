import { describe, expect, test } from "bun:test";
import { locales, m } from "@/features/i18n";
import { workspaceSiteConstants } from "@/shared/utils/site-constants";
import { getPublicOpeningHours } from "./public-offerings";

describe("getPublicOpeningHours", () => {
  const { openingHours } = workspaceSiteConstants;

  test("states the Open Space cut-off it is given", () => {
    for (const locale of locales) {
      expect(getPublicOpeningHours(locale)).toContain(
        openingHours.openSpaceUsableUntil
      );
      expect(
        getPublicOpeningHours(locale, {
          ...openingHours,
          openSpaceUsableUntil: "16:30",
        })
      ).toContain("16:30");
    }
  });

  test("adds the always-open statement only while the space is always open", () => {
    for (const locale of locales) {
      const alwaysOpen = getPublicOpeningHours(locale, {
        ...openingHours,
        alwaysOpen: true,
      });
      const limited = getPublicOpeningHours(locale, {
        ...openingHours,
        alwaysOpen: false,
      });

      const statement = m.publicOfferingAlwaysOpen({}, { locale });

      expect(alwaysOpen).toContain(statement);
      expect(limited).not.toContain(statement);
      expect(alwaysOpen).toEndWith(limited);
      expect(getPublicOpeningHours(locale)).toBe(
        openingHours.alwaysOpen ? alwaysOpen : limited
      );
    }
  });
});
