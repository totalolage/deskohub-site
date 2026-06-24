import type { Category, Product } from "@deskohub/dotypos/generated";
import type { Locale } from "@/features/i18n";
import { getLocalizedText } from "@/shared/utils/localization";

/**
 * Formatted menu item with localized text
 */
export interface FormattedMenuItem {
  id: string;
  name: string;
  description: string | undefined;
  priceWithVat: string | null | undefined;
  unit: string | undefined;
}

/**
 * Formatted category with localized text
 */
export interface FormattedCategory {
  name: string;
}

/**
 * Format a product with localized text for display
 * @param product - Raw product from API
 * @param locale - Target locale
 * @returns Formatted menu item with localized text
 */
export function formatMenuItem(
  product: Product,
  locale: Locale
): FormattedMenuItem {
  // Get localized name and description if available
  const localizedName =
    getLocalizedText(product.translatedName, locale, product.name) ??
    product.name ??
    "";

  const localizedDescription = getLocalizedText(
    product.translatedDescription,
    locale,
    product.description || product.subtitle
  );

  return {
    id: product.id ?? "",
    name: localizedName,
    description: localizedDescription ?? undefined,
    priceWithVat: product.priceWithVat,
    unit: product.unit,
  };
}

/**
 * Format a category with localized text for display
 * @param category - Raw category from API
 * @param locale - Target locale
 * @returns Formatted category with localized text
 */
export function formatCategory(
  category: Category,
  locale: Locale
): FormattedCategory {
  // Get localized category name if available
  const localizedName =
    getLocalizedText(category.translatedName, locale, category.name) ??
    category.name ??
    "";

  return {
    name: localizedName,
  };
}
