import type { DiscountCountdown } from "@/features/checkout/discount-countdown";
import type { Locale } from "@/features/i18n";
import { formatDuration } from "@/shared/utils/format-duration";

export const formatDiscountCountdown = (
  countdown: DiscountCountdown,
  locale: Locale
) => {
  const remainingUnits =
    countdown.unit === "second"
      ? [
          { value: Math.floor(countdown.value / 60), unit: "minute" as const },
          { value: countdown.value % 60, unit: "second" as const },
        ].filter(({ value }) => value > 0)
      : [countdown];

  return formatDuration(remainingUnits, locale);
};
