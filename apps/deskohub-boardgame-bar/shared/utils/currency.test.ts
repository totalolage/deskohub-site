import { describe, expect, test } from "bun:test";
import { formatCurrencyAmount } from "@deskohub/i18n/currency";
import { m } from "@/features/i18n";
import { formatPrice } from "./currency";

const locale = "cs-CZ";
const onRequest = m.priceOnRequest({}, { locale });

describe("formatPrice", () => {
  test("formats numeric and numeric-string prices in the menu currency", () => {
    const expected = formatCurrencyAmount({
      amount: 150,
      currency: "CZK",
      locale,
    });

    expect(formatPrice(150, locale)).toBe(expected);
    expect(formatPrice("150", locale)).toBe(expected);
  });

  test("formats in a given currency and locale", () => {
    expect(formatPrice(12.5, "en-US", "EUR")).toBe(
      formatCurrencyAmount({ amount: 12.5, currency: "EUR", locale: "en-US" })
    );
  });

  test.each([
    ["null", null],
    ["undefined", undefined],
    ["an empty string", ""],
    ["a non-numeric string", "free"],
    ["zero", 0],
    ["a negative price", -5],
    ["a negative string price", "-5"],
  ])("shows price on request for %s", (_label, price) => {
    expect(formatPrice(price, locale)).toBe(onRequest);
  });
});
