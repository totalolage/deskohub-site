/**
 * Formats a price amount using the Intl API for proper localization
 * Whole amounts render without minor units; fractional amounts fall back
 * to the currency's Intl default fraction digits
 * @param amount - The price amount in CZK
 * @param locale - The locale to use for formatting
 * @returns Formatted price string
 */
export const formatPrice = (amount: number, locale: string): string => {
  const fractionDigits = Number.isInteger(amount)
    ? { minimumFractionDigits: 0, maximumFractionDigits: 0 }
    : {};

  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "CZK",
    ...fractionDigits,
  }).format(amount);
};
