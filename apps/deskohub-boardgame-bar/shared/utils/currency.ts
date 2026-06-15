import { type Locale, m } from "@/features/i18n";
import { siteConstants } from "./constants";

/**
 * Format a price value as currency
 * Handles both string and number inputs from the API
 *
 * @returns Formatted price string (e.g., "150 Kč") or fallback text
 */
export function formatPrice(
  price: string | number | null | undefined,
  locale: Locale,
  currency: string = siteConstants.menu.currency
): string {
  // Handle null, undefined, or empty string
  if (price == null || price === "") {
    return m.priceOnRequest({}, { locale });
  }

  // Convert string to number if needed
  const numericPrice = typeof price === "string" ? Number(price) : price;

  // Handle invalid numbers or zero/negative prices
  if (Number.isNaN(numericPrice) || numericPrice <= 0) {
    return m.priceOnRequest({}, { locale });
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
