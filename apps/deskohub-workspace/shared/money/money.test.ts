import { describe, expect, test } from "bun:test";
import { BigDecimal, Result, Schema } from "effect";
import { currencyCZK } from "./currencies";
import {
  formatMoney,
  type Money,
  MoneyPrecisionError,
  MoneyUnitMismatch,
  moneyCodec,
  moneyEquals,
  moneyFromBigDecimal,
  moneyMajorAmount,
  moneyToBigDecimal,
  moneyToDecimalString,
  moneyWithValue,
  nonNegativeMoneyCodec,
  positiveMoneyCodec,
  sameMoneyUnit,
  sumMoney,
} from "./money";

const czk = (value: number): Money => ({ value, exponent: 2, currency: "CZK" });
const eur = (value: number): Money => ({ value, exponent: 2, currency: "EUR" });

describe("money codecs", () => {
  const decodes = (codec: Schema.Codec<Money, Money>, input: Money) =>
    Result.isSuccess(Schema.decodeUnknownResult(codec)(input));

  test("accept scaled integers with a non-negative exponent and ISO code", () => {
    expect(decodes(moneyCodec, czk(-1250))).toBe(true);
    expect(
      decodes(moneyCodec, { value: 7, exponent: 0, currency: "JPY" })
    ).toBe(true);
  });

  test("reject fractional values, negative exponents and non-ISO codes", () => {
    expect(decodes(moneyCodec, czk(12.5))).toBe(false);
    expect(decodes(moneyCodec, { ...czk(100), exponent: -1 })).toBe(false);
    expect(decodes(moneyCodec, { ...czk(100), exponent: 1.5 })).toBe(false);
    expect(decodes(moneyCodec, { ...czk(100), currency: "czk" })).toBe(false);
    expect(decodes(moneyCodec, { ...czk(100), currency: "" })).toBe(false);
  });

  test("bound the value by sign", () => {
    expect(decodes(nonNegativeMoneyCodec, czk(0))).toBe(true);
    expect(decodes(nonNegativeMoneyCodec, czk(-1))).toBe(false);
    expect(decodes(positiveMoneyCodec, czk(1))).toBe(true);
    expect(decodes(positiveMoneyCodec, czk(0))).toBe(false);
  });
});

describe("money units", () => {
  test("match only on both currency and exponent", () => {
    expect(sameMoneyUnit(czk(1), czk(2))).toBe(true);
    expect(sameMoneyUnit(czk(1), eur(1))).toBe(false);
    expect(sameMoneyUnit(czk(1), { ...czk(1), exponent: 3 })).toBe(false);
  });

  test("give a value the unit of a template", () => {
    expect(moneyWithValue(990, eur(100))).toEqual(eur(990));
    expect(currencyCZK(12_550)).toEqual(czk(12_550));
  });

  test("compare amounts by value and unit, treating two absent amounts as equal", () => {
    expect(moneyEquals(czk(100), czk(100))).toBe(true);
    expect(moneyEquals(czk(100), czk(101))).toBe(false);
    expect(moneyEquals(czk(100), eur(100))).toBe(false);
    expect(moneyEquals(czk(100), undefined)).toBe(false);
    expect(moneyEquals(undefined, undefined)).toBe(true);
  });
});

describe("sumMoney", () => {
  test("totals amounts that share a unit", () => {
    expect(sumMoney([czk(100)])).toEqual(Result.succeed(czk(100)));
    expect(sumMoney([czk(100), czk(250), czk(-50)])).toEqual(
      Result.succeed(czk(300))
    );
  });

  test("rejects a mixed currency or exponent with both units", () => {
    expect(sumMoney([czk(100), eur(100)])).toEqual(
      Result.fail(
        new MoneyUnitMismatch({
          expected: { currency: "CZK", exponent: 2 },
          actual: { currency: "EUR", exponent: 2 },
        })
      )
    );
    expect(
      Result.isFailure(sumMoney([czk(100), { ...czk(100), exponent: 0 }]))
    ).toBe(true);
  });
});

describe("exact decimal conversion", () => {
  test("converts minor units to the exact decimal", () => {
    expect(
      BigDecimal.equals(
        moneyToBigDecimal(czk(12_550)),
        BigDecimal.fromStringUnsafe("125.5")
      )
    ).toBe(true);
    expect(
      BigDecimal.equals(
        moneyToBigDecimal(czk(-5)),
        BigDecimal.fromStringUnsafe("-0.05")
      )
    ).toBe(true);
  });

  test("reads a decimal into a unit without rounding", () => {
    const unit = { currency: "CZK", exponent: 2 };
    expect(
      moneyFromBigDecimal(BigDecimal.fromStringUnsafe("125.5"), unit)
    ).toEqual(Result.succeed(czk(12_550)));
    expect(
      moneyFromBigDecimal(BigDecimal.fromStringUnsafe("125.5000"), unit)
    ).toEqual(Result.succeed(czk(12_550)));
    expect(
      moneyFromBigDecimal(BigDecimal.fromStringUnsafe("-0.05"), unit)
    ).toEqual(Result.succeed(czk(-5)));
    expect(
      moneyFromBigDecimal(BigDecimal.fromStringUnsafe("125"), {
        currency: "CZK",
        exponent: 0,
      })
    ).toEqual(Result.succeed({ value: 125, exponent: 0, currency: "CZK" }));
  });

  test("round-trips every amount through its decimal", () => {
    for (const money of [czk(0), czk(1), czk(-12_550), eur(99_999_999)]) {
      expect(moneyFromBigDecimal(moneyToBigDecimal(money), money)).toEqual(
        Result.succeed(money)
      );
    }
  });

  test("rejects more fraction digits than the exponent or an unsafe value", () => {
    const unit = { currency: "CZK", exponent: 2 };
    expect(
      moneyFromBigDecimal(BigDecimal.fromStringUnsafe("125.505"), unit)
    ).toEqual(
      Result.fail(new MoneyPrecisionError({ amount: "125.505", unit }))
    );
    expect(
      Result.isFailure(
        moneyFromBigDecimal(
          BigDecimal.fromStringUnsafe("100000000000000000000"),
          unit
        )
      )
    ).toBe(true);
  });

  test("writes every minor digit as plain decimal text", () => {
    expect(moneyToDecimalString(czk(12_550))).toBe("125.50");
    expect(moneyToDecimalString(czk(500))).toBe("5.00");
    expect(moneyToDecimalString(czk(5))).toBe("0.05");
    expect(moneyToDecimalString(czk(-5))).toBe("-0.05");
    expect(moneyToDecimalString(czk(-1250))).toBe("-12.50");
    expect(moneyToDecimalString(czk(0))).toBe("0.00");
    expect(moneyToDecimalString(czk(-0))).toBe("0.00");
    expect(
      moneyToDecimalString({ value: 12_345, exponent: 0, currency: "CZK" })
    ).toBe("12345");
    expect(
      moneyToDecimalString({ value: 7, exponent: 3, currency: "BHD" })
    ).toBe("0.007");
  });
});

describe("money display", () => {
  test("writes amounts in currency units", () => {
    expect(moneyMajorAmount(czk(125_050))).toBe(1250.5);
    expect(moneyMajorAmount({ value: 900, exponent: 0, currency: "CZK" })).toBe(
      900
    );
  });

  test("formats money in en-US", () => {
    expect(formatMoney(czk(21_750), "en-US")).toBe("CZK 217.50");
    expect(formatMoney(czk(120_000), "en-US")).toBe("CZK 1,200");
    expect(formatMoney(eur(1_999), "en-US")).toBe("€19.99");
  });

  test("formats money in cs-CZ", () => {
    expect(formatMoney(czk(21_750), "cs-CZ")).toBe("217,50 Kč");
    expect(formatMoney(czk(120_000), "cs-CZ")).toBe("1 200 Kč");
    expect(formatMoney(czk(-12_550), "cs-CZ")).toBe("-125,50 Kč");
  });
});
