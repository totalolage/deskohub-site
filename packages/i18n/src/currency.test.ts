import { describe, expect, test } from "bun:test";
import { BigDecimal } from "effect";
import { formatCurrencyAmount, formatCurrencyName } from "./currency";

describe("formatCurrencyAmount", () => {
  test("renders whole amounts without minor units", () => {
    expect(
      formatCurrencyAmount({
        amount: 410,
        currency: "CZK",
        locale: "en",
        fractionDigits: 2,
      })
    ).toBe("CZK 410");
    expect(
      formatCurrencyAmount({
        amount: 410,
        currency: "CZK",
        locale: "cs",
        fractionDigits: 2,
      })
    ).toBe("410 Kč");
  });

  test("pads fractional amounts to the currency's minor digits", () => {
    expect(
      formatCurrencyAmount({
        amount: 307.5,
        currency: "CZK",
        locale: "en",
        fractionDigits: 2,
      })
    ).toContain("307.50");
    expect(
      formatCurrencyAmount({
        amount: 307.5,
        currency: "CZK",
        locale: "cs",
        fractionDigits: 2,
      })
    ).toBe("307,50 Kč");
  });
});

describe("formatCurrencyAmount with an exact decimal", () => {
  const format = (amount: string, locale: string) =>
    formatCurrencyAmount({
      amount: BigDecimal.fromStringUnsafe(amount),
      currency: "CZK",
      locale,
      fractionDigits: 2,
    });

  test.each([
    ["410.00", 410],
    ["1234.5", 1234.5],
    ["0.01", 0.01],
    ["-100", -100],
  ])("formats %s like the same number", (amount, number) => {
    for (const locale of ["cs", "en"]) {
      expect(format(amount, locale)).toBe(
        formatCurrencyAmount({
          amount: number,
          currency: "CZK",
          locale,
          fractionDigits: 2,
        })
      );
    }
  });

  test("keeps every digit a number would round", () => {
    expect(format("99999999999999.99", "en")).toContain(
      "99,999,999,999,999.99"
    );
  });
});

describe("formatCurrencyName", () => {
  test("names the currency in the reader's language", () => {
    expect(formatCurrencyName({ currency: "CZK", locale: "cs-CZ" })).toBe(
      "česká koruna"
    );
    expect(formatCurrencyName({ currency: "EUR", locale: "en-US" })).toBe(
      "Euro"
    );
  });
});
