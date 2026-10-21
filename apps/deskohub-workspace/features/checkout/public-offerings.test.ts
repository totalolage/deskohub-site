import { describe, expect, test } from "bun:test";
import { locales } from "@/features/i18n";
import { workspaceSiteConstants } from "@/shared/utils/site-constants";
import { getPublicOpeningHours } from "./public-offerings";

describe("getPublicOpeningHours", () => {
  const { openingHours } = workspaceSiteConstants;

  test("states the Open Space cut-off from the site constants", () => {
    for (const locale of locales) {
      expect(getPublicOpeningHours(locale)).toContain(
        openingHours.openSpaceUsableUntil
      );
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

      expect(alwaysOpen).toEndWith(limited);
      expect(alwaysOpen.length).toBeGreaterThan(limited.length);
      expect(getPublicOpeningHours(locale)).toBe(
        openingHours.alwaysOpen ? alwaysOpen : limited
      );
    }
  });
});
