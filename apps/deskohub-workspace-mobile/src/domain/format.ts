import type { Locale, LocalizedText, Money, PurchaseStatus } from "./shop";

const localeTags: Record<Locale, string> = {
  cs: "cs-CZ",
  en: "en-GB",
};

export function localizeText(text: LocalizedText, locale: Locale): string {
  return getTranslatedValue(text, locale, text.en) ?? text.en;
}

export function formatMoney(money: Money, locale: Locale): string {
  return new Intl.NumberFormat(localeTags[locale], {
    style: "currency",
    currency: money.currency,
    minimumFractionDigits: money.minorUnits % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(money.minorUnits / 100);
}

export function formatPragueDateTime(value: string, locale: Locale): string {
  return new Intl.DateTimeFormat(localeTags[locale], {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Prague",
  }).format(new Date(value));
}

export function formatPragueDay(value: string, locale: Locale): string {
  return new Intl.DateTimeFormat(localeTags[locale], {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "Europe/Prague",
  }).format(new Date(value));
}

export function getDefaultLocale(): Locale {
  const locale = Intl.DateTimeFormat().resolvedOptions().locale.toLowerCase();
  return locale.startsWith("cs") ? "cs" : "en";
}

export function isSettledPurchase(status: PurchaseStatus): boolean {
  return (
    status === "paid" ||
    status === "failed" ||
    status === "cancelled" ||
    status === "expired"
  );
}

import { getTranslatedValue } from "@deskohub/i18n/translatable";
