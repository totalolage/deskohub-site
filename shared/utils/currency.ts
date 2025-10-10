import { siteConstants } from "./constants";

/**
 * Format a price value as currency
 * Handles both string and number inputs from the API
 *
 * @param price - Price value (can be string or number)
 * @param locale - Locale for formatting (defaults to site's default locale)
 * @param currency - Currency code (defaults to site's default currency)
 * @returns Formatted price string (e.g., "150 Kč") or fallback text
 */
export function formatPrice(
  price: string | number | null | undefined,
  locale: string = siteConstants.menu.defaultLocale,
  currency: string = siteConstants.menu.currency
): string {
  // Handle null, undefined, or empty string
  if (price == null || price === "") {
    return "Na dotaz";
  }

  // Convert string to number if needed
  const numericPrice = typeof price === "string" ? Number(price) : price;

  // Handle invalid numbers or zero/negative prices
  if (Number.isNaN(numericPrice) || numericPrice <= 0) {
    return "Na dotaz";
  }

  // Format using Intl.NumberFormat for proper localization
  const formatter = new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });

  return formatter.format(numericPrice);
}
