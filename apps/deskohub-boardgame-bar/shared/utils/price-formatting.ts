/**
 * Formats a price amount using the Intl API for proper localization
 * @param amount - The price amount in CZK
 * @param locale - The locale to use for formatting
 * @returns Formatted price string
 */
export const formatPrice = (amount: number, locale: string): string => {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "CZK",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
};
