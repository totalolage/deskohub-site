import { describe, expect, test } from "bun:test";
import { moneyAmountText } from "./money";

describe("moneyAmountText", () => {
  test.each([
    [{ value: 12_350, exponent: 2, currency: "CZK" }, "123.50"],
    [{ value: 5, exponent: 2, currency: "CZK" }, "0.05"],
    [{ value: 0, exponent: 2, currency: "CZK" }, "0.00"],
    [{ value: -1_250, exponent: 2, currency: "CZK" }, "-12.50"],
    [{ value: 400, exponent: 0, currency: "CZK" }, "400"],
  ])("%o is %s", (money, text) => {
    expect(moneyAmountText(money)).toBe(text);
  });
});
