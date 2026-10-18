/**
 * Formats a currency amount for display. Whole amounts render without minor
 * units; fractional amounts render every minor digit of the currency, so a
 * price never shows a truncated fraction such as "307.5".
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
  readonly amount: number;
  readonly currency: string;
  readonly locale: string;
  readonly fractionDigits?: number;
}): string {
  const digits = Number.isInteger(amount) ? 0 : fractionDigits;

  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    ...(digits !== undefined && {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }),
  }).format(amount);
}

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
