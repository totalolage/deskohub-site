import { m } from "@/features/administration/i18n";
import type { Locale } from "@/features/i18n";
import { formatCount } from "@/shared/utils/number";

/** A use limit or remaining count, where no limit reads "Unlimited". */
export const formatDiscountUsageLimit = (
  limit: number | null,
  locale: Locale
) =>
  limit === null
    ? m.discountsUnlimited({}, { locale })
    : formatCount(limit, locale);
