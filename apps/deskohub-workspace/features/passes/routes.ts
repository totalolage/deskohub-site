import type { Locale } from "@/features/i18n";
import type { OrderId } from "@/features/order";
import { reservationAccessPath } from "@/features/reservation/routes";

export const entryPackCheckoutPath = "/passes/entry-pack";
export const unlimitedPassCheckoutPath = "/passes/unlimited";

export const getUnlimitedRenewalPath = (locale: Locale, orderId: OrderId) =>
  `/${locale}${unlimitedPassCheckoutPath}?renew=${encodeURIComponent(orderId)}`;

export const getUnlimitedAccessPath = (locale: Locale, orderId: OrderId) =>
  `/${locale}${reservationAccessPath}/${encodeURIComponent(orderId)}`;
