import { formatCurrencyAmount } from "@deskohub/i18n/currency";
import { BigDecimal, Data, Result, Schema } from "effect";
import type { Locale } from "@/features/i18n";

/**
 * An amount of money as a scaled integer: `value` minor units at a decimal
 * `exponent` in an ISO 4217 `currency`, such as 12550 at exponent 2 in CZK for
 * 125.50 Kč.
 */
export type Money = {
  readonly value: number;
  readonly exponent: number;
  readonly currency: string;
};

/** The currency and exponent that amounts must share to be combined. */
export type MoneyUnit = Pick<Money, "currency" | "exponent">;

const moneyExponentSchema = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

const moneyCurrencySchema = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^[A-Z]{3}$/)),
  Schema.brand("MoneyCurrency")
).annotate({
  identifier: "MoneyCurrency",
  description: "ISO 4217 uppercase alphabetic currency code.",
});

export const moneyCodec: Schema.Codec<Money, Money> = Schema.Struct({
  value: Schema.Int,
  exponent: moneyExponentSchema,
  currency: moneyCurrencySchema,
}).annotate({
  identifier: "Money",
  description:
    "Money stored as a scaled integer value, decimal exponent, and ISO currency code.",
});

export const nonNegativeMoneyCodec: Schema.Codec<Money, Money> = Schema.Struct({
  value: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  exponent: moneyExponentSchema,
  currency: moneyCurrencySchema,
}).annotate({
  identifier: "NonNegativeMoney",
  description:
    "Non-negative money stored as a scaled integer value, decimal exponent, and ISO currency code.",
});

export const positiveMoneyCodec: Schema.Codec<Money, Money> = Schema.Struct({
  value: Schema.Int.check(Schema.isGreaterThan(0)),
  exponent: moneyExponentSchema,
  currency: moneyCurrencySchema,
}).annotate({
  identifier: "PositiveMoney",
  description:
    "Positive money stored as a scaled integer value, decimal exponent, and ISO currency code.",
});

/** Amounts in different currencies or exponents were combined. */
export class MoneyUnitMismatch extends Data.TaggedError("MoneyUnitMismatch")<{
  readonly expected: MoneyUnit;
  readonly actual: MoneyUnit;
}> {}

/** A decimal amount has no exact scaled-integer value in the requested unit. */
export class MoneyPrecisionError extends Data.TaggedError(
  "MoneyPrecisionError"
)<{
  readonly amount: string;
  readonly unit: MoneyUnit;
}> {}

const moneyUnitOf = ({ currency, exponent }: MoneyUnit): MoneyUnit => ({
  currency,
  exponent,
});

export const sameMoneyUnit = (left: MoneyUnit, right: MoneyUnit) =>
  left.currency === right.currency && left.exponent === right.exponent;

/** `value` minor units in the currency and exponent of `unit`. */
export const moneyWithValue = (value: number, unit: MoneyUnit): Money => ({
  value,
  exponent: unit.exponent,
  currency: unit.currency,
});

/** Totals amounts that share one unit; the total keeps that unit. */
export const sumMoney = (
  amounts: readonly [Money, ...Money[]]
): Result.Result<Money, MoneyUnitMismatch> => {
  const [first, ...rest] = amounts;
  let total = first;
  for (const amount of rest) {
    if (!sameMoneyUnit(total, amount)) {
      return Result.fail(
        new MoneyUnitMismatch({
          expected: moneyUnitOf(total),
          actual: moneyUnitOf(amount),
        })
      );
    }
    total = moneyWithValue(total.value + amount.value, total);
  }
  return Result.succeed(total);
};

export const moneyEquals = (
  left: Money | undefined,
  right: Money | undefined
) =>
  left?.value === right?.value &&
  left?.currency === right?.currency &&
  left?.exponent === right?.exponent;

/** The exact decimal amount, such as 125.50 for 12550 at exponent 2. */
export const moneyToBigDecimal = (money: Money): BigDecimal.BigDecimal =>
  BigDecimal.make(BigInt(money.value), money.exponent);

/**
 * The exact amount in `unit`, which must come from decoded money or the
 * currency catalog (a non-negative integer exponent). Trailing zeros beyond the
 * exponent are fine; fails when it would discard a nonzero digit or the scaled
 * value is not a safe integer. It never rounds.
 */
export const moneyFromBigDecimal = (
  amount: BigDecimal.BigDecimal,
  unit: MoneyUnit
): Result.Result<Money, MoneyPrecisionError> => {
  const scaled = BigDecimal.scale(amount, unit.exponent);
  const value = Number(scaled.value);
  return BigDecimal.equals(scaled, amount) && Number.isSafeInteger(value)
    ? Result.succeed(moneyWithValue(value, unit))
    : Result.fail(
        new MoneyPrecisionError({ amount: BigDecimal.format(amount), unit })
      );
};

/**
 * The exact amount as plain decimal text with every minor digit, such as
 * "125.50" or "-0.05". Never rounds and never uses scientific notation.
 */
export const moneyToDecimalString = (money: Money) => {
  const { scale, value } = moneyToBigDecimal(money);
  const sign = value < 0n ? "-" : "";
  const digits = (value < 0n ? -value : value)
    .toString()
    .padStart(scale + 1, "0");
  return scale === 0
    ? `${sign}${digits}`
    : `${sign}${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
};

/**
 * The amount in currency units as a JavaScript number, such as 125.5 for 12550
 * at exponent 2. Use it only where a number is required, such as `Intl` or an
 * external contract; it is not exact for arithmetic.
 */
export const moneyMajorAmount = (money: Money) =>
  money.value / 10 ** money.exponent;

/**
 * Formats money for display in `locale`. Whole amounts drop minor digits;
 * fractional amounts show every minor digit of the exponent.
 */
export const formatMoney = (money: Money, locale: Locale) =>
  formatCurrencyAmount({
    amount: moneyMajorAmount(money),
    currency: money.currency,
    locale,
    fractionDigits: money.exponent,
  });
