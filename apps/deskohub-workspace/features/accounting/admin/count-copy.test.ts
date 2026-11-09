import { describe, expect, test } from "bun:test";
import { m } from "@/features/administration/i18n";
import type { Locale } from "@/features/i18n";
import { formatCount } from "@/shared/utils/number";

describe("invoice administration count copy", () => {
  test.each<Locale>(["en-US", "cs-CZ"])(
    "groups the digits of large numbers in %s",
    (locale) => {
      const grouped = formatCount(1000, locale);

      expect(
        m.accountingInvoiceListCount({ count: 1000 }, { locale })
      ).toContain(grouped);
      expect(
        m.accountingInvoiceFormMaxLength({ maximumLength: 1000 }, { locale })
      ).toContain(grouped);
      expect(
        m.accountingInvoiceFormLinesHint({ decimalPlaces: 1000 }, { locale })
      ).toContain(grouped);
    }
  );

  test("picks the plural form from the number", () => {
    const cs = { locale: "cs-CZ" } as const;

    expect(
      m.accountingInvoiceListCount({ count: 1 }, { locale: "en-US" })
    ).toBe("1 invoice");
    expect(m.accountingInvoiceListCount({ count: 2 }, cs)).toBe("2 faktury");
    expect(m.accountingInvoiceListCount({ count: 1000 }, cs)).toBe(
      `${formatCount(1000, "cs-CZ")} faktur`
    );
    expect(m.accountingInvoiceFormLinesHint({ decimalPlaces: 2 }, cs)).toBe(
      "Zadejte ceny včetně znaménka s nejvýše 2 desetinnými místy."
    );
  });
});
