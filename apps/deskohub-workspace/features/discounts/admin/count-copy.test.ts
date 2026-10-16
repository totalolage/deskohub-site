import { describe, expect, test } from "bun:test";
import { m } from "@/features/administration/i18n";
import type { Locale } from "@/features/i18n";
import { formatCount } from "@/shared/utils/number";

const countMessages = [
  m.discountsCodesCount,
  m.discountsVouchersCount,
  m.discountsSalesCount,
  m.discountsAudienceCustomerCount,
  m.discountsCodeAudienceCount,
  m.discountsVoucherAudienceCount,
  m.discountsAvailabilitySelectedCustomers,
];

const addCustomerDescriptions = [
  m.discountsCodeAddCustomerDialogDescription,
  m.discountsVoucherAddCustomerDialogDescription,
];

describe("discount administration count copy", () => {
  test.each<Locale>(["en-US", "cs-CZ"])(
    "groups the digits of large counts in %s",
    (locale) => {
      for (const message of countMessages) {
        expect(message({ count: 1000 }, { locale })).toContain(
          formatCount(1000, locale)
        );
      }
      for (const message of addCustomerDescriptions) {
        const text = message(
          {
            code: "SUMMER10",
            customerName: "Test Customer",
            count: 1000,
            total: 1001,
          },
          { locale }
        );
        expect(text).toContain(formatCount(1000, locale));
        expect(text).toContain(formatCount(1001, locale));
      }
    }
  );

  test("picks the plural form from the count", () => {
    const en = { locale: "en-US" } as const;
    const cs = { locale: "cs-CZ" } as const;

    expect(m.discountsAudienceCustomerCount({ count: 1 }, en)).toBe(
      "1 customer"
    );
    expect(m.discountsAudienceCustomerCount({ count: 1000 }, en)).toBe(
      `${formatCount(1000, "en-US")} customers`
    );
    expect(m.discountsAudienceCustomerCount({ count: 1 }, cs)).toBe(
      "1 zákazník"
    );
    expect(m.discountsAudienceCustomerCount({ count: 3 }, cs)).toBe(
      "3 zákazníci"
    );
    expect(m.discountsAudienceCustomerCount({ count: 1000 }, cs)).toBe(
      `${formatCount(1000, "cs-CZ")} zákazníků`
    );
    expect(
      m.discountsCodeAddCustomerDialogDescription(
        { code: "SUMMER10", customerName: "Test Customer", count: 2, total: 3 },
        cs
      )
    ).toBe(
      "Kód SUMMER10 je teď omezen na 2 další zákazníky. Po přidání zákazníka Test Customer bude dostupný 3 zákazníkům."
    );
  });
});
