import { formatCurrencyAmount } from "@deskohub/i18n/currency";

/**
 * Formats a CZK price amount for the given locale
 * @param amount - The price amount in CZK
 * @param locale - The locale to use for formatting
 * @returns Formatted price string
 */
export const formatPrice = (amount: number, locale: string): string =>
  formatCurrencyAmount({ amount, currency: "CZK", locale });
