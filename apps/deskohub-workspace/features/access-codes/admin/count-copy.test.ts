import { describe, expect, test } from "bun:test";
import { m } from "@/features/administration/i18n";
import type { Locale } from "@/features/i18n";
import { formatCount } from "@/shared/utils/number";

describe("access code administration count copy", () => {
  test.each<Locale>(["en-US", "cs-CZ"])(
    "groups the digits of large limits in %s",
    (locale) => {
      expect(m.accessCodesNameTooLong({ maximum: 1000 }, { locale })).toContain(
        formatCount(1000, locale)
      );
      const window = m.accessCodesWindowDurationInvalid(
        { minimum: 1000, maximum: 2000 },
        { locale }
      );
      expect(window).toContain(formatCount(1000, locale));
      expect(window).toContain(formatCount(2000, locale));
    }
  );

  test("picks the plural form from the maximum", () => {
    const cs = { locale: "cs-CZ" } as const;

    expect(m.accessCodesNameTooLong({ maximum: 1 }, { locale: "en-US" })).toBe(
      "Use at most 1 character."
    );
    expect(m.accessCodesNameTooLong({ maximum: 4 }, cs)).toBe(
      "Použijte nejvýše 4 znaky."
    );
    expect(
      m.accessCodesWindowDurationInvalid({ minimum: 1, maximum: 24 }, cs)
    ).toBe("Konec musí být 1 až 24 hodin po začátku.");
  });
});
