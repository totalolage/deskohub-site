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

/**
 * Formats a price range (e.g., "50 - 100 Kč")
 * @param minAmount - The minimum price amount
 * @param maxAmount - The maximum price amount
 * @param locale - The locale to use for formatting
 * @returns Formatted price range string
 */
export const formatPriceRange = (
  minAmount: number,
  maxAmount: number,
  locale: string
): string => {
  const formatter = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "CZK",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });

  // Let the Intl API handle the formatting based on locale
  // Use formatRange if available (newer browsers)
  if (formatter.formatRange) {
    return formatter.formatRange(minAmount, maxAmount);
  }

  // Fallback for older browsers
  return `${formatter.format(minAmount)} - ${formatter.format(maxAmount)}`;
};
