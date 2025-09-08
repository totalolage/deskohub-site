"use client";

import { useLocale } from "@/features/i18n/utils/use-locale";
import { cn } from "@/shared/utils";
import { formatPrice } from "@/shared/utils/price-formatting";

interface PriceProps {
  amount: number;
  locale?: string;
  className?: string;
}

/**
 * Reusable component for displaying formatted prices
 * Uses the Intl API to ensure proper localization
 */
export const Price = ({ amount, locale, className }: PriceProps) => {
  const defaultLocale = useLocale();
  const userLocale = locale || defaultLocale;
  const formatted = formatPrice(amount, userLocale);

  return <span className={cn("font-semibold", className)}>{formatted}</span>;
};
