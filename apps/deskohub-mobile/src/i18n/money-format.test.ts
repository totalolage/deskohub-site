import { describe, expect, test } from "bun:test";
import { formatMoney, minorUnitsText } from "./money-format";

describe("minorUnitsText", () => {
  test.each([
    [45000, 2, "450.00"],
    [5, 2, "0.05"],
    [0, 2, "0.00"],
    [-1250, 2, "-12.50"],
    [1234, 0, "1234"],
    [7, 3, "0.007"],
  ])("%d at exponent %d reads %s", (value, exponent, text) => {
    expect(minorUnitsText({ value, exponent })).toBe(text);
  });
});

describe("formatMoney", () => {
  test("formats the amount with the currency's minor units", () => {
    expect(
      formatMoney({ value: 123450, exponent: 2, currency: "CZK" }, "cs-CZ")
    ).toBe(
      new Intl.NumberFormat("cs-CZ", {
        style: "currency",
        currency: "CZK",
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(1234.5)
    );
  });
});
