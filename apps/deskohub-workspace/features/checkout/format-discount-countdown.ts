import type { DiscountCountdown } from "@/features/checkout/discount-countdown";
import type { Locale } from "@/features/i18n";

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

  return new Intl.ListFormat(locale, {
    style: "long",
    type: "conjunction",
  }).format(
    remainingUnits.map(({ value, unit }) =>
      new Intl.NumberFormat(locale, {
        style: "unit",
        unit,
        unitDisplay: "long",
      }).format(value)
    )
  );
};
