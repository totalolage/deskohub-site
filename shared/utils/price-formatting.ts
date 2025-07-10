/**
 * Formats a price amount using the Intl API for proper localization
 * @param amount - The price amount in CZK
 * @param locale - The locale to use for formatting (defaults to 'cs-CZ')
 * @returns Formatted price string
 */
export const formatPrice = (
  amount: number,
  locale: string = "cs-CZ"
): string => {
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
  locale: string = "cs-CZ"
): string => {
  const formatter = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "CZK",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });

  // For Czech locale, we want "50 - 100 Kč" format
  if (locale.startsWith("cs")) {
    return `${formatter.format(minAmount).replace(" Kč", "")} - ${formatter.format(maxAmount)}`;
  }

  // For other locales, use standard format
  return `${formatter.format(minAmount)} - ${formatter.format(maxAmount)}`;
};
