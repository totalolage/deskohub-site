import { getLocaleDefinition } from "@deskohub/i18n/locale-registry";
import type { Locale } from "@/features/i18n";

/**
 * The locales an operator writes a discount's label in. Every other locale
 * reads one of them through its fallback chain (`discountLabelFor`).
 */
export const discountLabelLocales = [
  "en-US",
  "cs-CZ",
] as const satisfies readonly Locale[];

export type DiscountLabelLocale = (typeof discountLabelLocales)[number];

/** A discount's label in each locale operators write labels in. */
export type DiscountLabels = Readonly<Record<DiscountLabelLocale, string>>;

const isDiscountLabelLocale = (locale: Locale): locale is DiscountLabelLocale =>
  (discountLabelLocales as readonly Locale[]).includes(locale);

/**
 * A discount's label in `locale`: the label written in it, else the first
 * locale of its fallback chain that operators write labels in.
 */
export const discountLabelFor = (
  labels: DiscountLabels,
  locale: Locale
): string =>
  labels[
    [locale, ...getLocaleDefinition(locale).fallbackChain].find(
      isDiscountLabelLocale
    ) ?? discountLabelLocales[0]
  ];
