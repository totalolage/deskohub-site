import { formatCurrencyAmount } from "@deskohub/i18n/currency";
import type { AppLocale } from "./app-locale";

/** An amount as the customer API sends it: `value` minor units of `exponent`. */
export interface MinorUnitMoney {
  readonly value: number;
  readonly exponent: number;
  readonly currency: string;
}

/** The exact decimal text of `value` minor units, e.g. 45000 at 2 → "450.00". */
export const minorUnitsText = ({
  value,
  exponent,
}: Pick<MinorUnitMoney, "value" | "exponent">): string => {
  const digits = Math.abs(value)
    .toString()
    .padStart(exponent + 1, "0");
  const whole = digits.slice(0, digits.length - exponent);
  const fraction = digits.slice(digits.length - exponent);
  return `${value < 0 ? "-" : ""}${whole}${exponent > 0 ? `.${fraction}` : ""}`;
};

/** Formats a customer API amount for the locale, with its currency's minor units. */
export const formatMoney = (money: MinorUnitMoney, locale: AppLocale) =>
  formatCurrencyAmount({
    amount: minorUnitsText(money),
    currency: money.currency,
    locale,
    fractionDigits: money.exponent,
  });
