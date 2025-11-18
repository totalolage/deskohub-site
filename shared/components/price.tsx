"use client";

import { useLocale } from "@/features/i18n/utils/use-locale";
import { cn } from "@/shared/utils";
import { formatPrice } from "@/shared/utils/price-formatting";

/**
 * Reusable component for displaying formatted prices
 * Uses the Intl API to ensure proper localization
 */
export const Price = ({
  amount,
  className,
}: {
  amount: number;
  className?: string;
}) => {
  const locale = useLocale();
  const formatted = formatPrice(amount, locale);

  return <span className={cn("font-semibold", className)}>{formatted}</span>;
};
