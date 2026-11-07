import { formatCurrencyAmount } from "@deskohub/i18n/currency";
import type { CustomerLocale, Money } from "@deskohub/workspace-customer-api";

/** A contract amount as exact decimal text, such as `{ value: 12350, exponent: 2 }` -> "123.50". */
export const moneyAmountText = ({ value, exponent }: Money): string => {
  const digits = Math.abs(value)
    .toString()
    .padStart(exponent + 1, "0");
  const whole = digits.slice(0, digits.length - exponent);
  const fraction = digits.slice(digits.length - exponent);
  const sign = value < 0 ? "-" : "";
  return exponent === 0 ? `${sign}${whole}` : `${sign}${whole}.${fraction}`;
};

/** A contract amount as the customer reads it, such as "1 234,50 Kč". */
export const formatMoney = (money: Money, locale: CustomerLocale): string =>
  formatCurrencyAmount({
    amount: moneyAmountText(money),
    currency: money.currency,
    locale,
    fractionDigits: money.exponent,
  });
