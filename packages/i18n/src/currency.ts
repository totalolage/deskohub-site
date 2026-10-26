import { BigDecimal, Option } from "effect";

/**
 * Formats a currency amount for display. Whole amounts render without minor
 * units; fractional amounts render every minor digit of the currency, so a
 * price never shows a truncated fraction such as "307.5".
 *
 * Pass decimal text, such as "1234.50", to render it exactly: every digit
 * survives, however large, where a JavaScript number would round. A negative
 * zero such as "-0.00" keeps its sign, as the same number would. Text that is
 * not a plain decimal formats as `Number(text)` does.
 *
 * `fractionDigits` is the currency's minor-unit exponent. When omitted, the
 * Intl currency default applies.
 */
export function formatCurrencyAmount({
  amount,
  currency,
  locale,
  fractionDigits,
}: {
  readonly amount: number | string;
  readonly currency: string;
  readonly locale: string;
  readonly fractionDigits?: number;
}): string {
  const { value, whole } = toFormattableAmount(amount);
  const digits = whole ? 0 : fractionDigits;

  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    ...(digits !== undefined && {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }),
  }).format(value);
}

const toFormattableAmount = (
  amount: number | string
): {
  readonly value: number | Intl.StringNumericLiteral;
  readonly whole: boolean;
} => {
  if (typeof amount === "number") {
    return { value: amount, whole: Number.isInteger(amount) };
  }
  return Option.match(BigDecimal.fromString(amount), {
    onNone: () => toFormattableAmount(Number(amount)),
    onSome: (decimal) => {
      // BigDecimal has no negative zero, so the sign comes from the text.
      const sign =
        BigDecimal.isZero(decimal) && amount.startsWith("-") ? "-" : "";
      return {
        // Intl formats a numeric string as an exact decimal, not as a double.
        value:
          `${sign}${decimal.value}e${-decimal.scale}` as Intl.StringNumericLiteral,
        whole: BigDecimal.isInteger(decimal),
      };
    },
  });
};

/**
 * Names a currency in the reader's language, such as "česká koruna" for CZK in
 * Czech. Falls back to the ISO code when the runtime has no display name.
 */
export function formatCurrencyName({
  currency,
  locale,
}: {
  readonly currency: string;
  readonly locale: string;
}): string {
  return (
    new Intl.DisplayNames([locale], { type: "currency" }).of(currency) ??
    currency
  );
}
