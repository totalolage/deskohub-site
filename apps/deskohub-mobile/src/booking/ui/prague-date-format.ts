import type { CustomerLocale } from "@deskohub/workspace-customer-api";
import type { PragueDate } from "../selection/prague-date";

/**
 * A Prague calendar date as the customer reads it, such as "Friday 13
 * November". The date is formatted at its UTC noon in UTC, so no time zone
 * moves it to another day.
 */
export const formatPragueDate = (
  date: PragueDate,
  locale: CustomerLocale,
  options: Intl.DateTimeFormatOptions = {
    weekday: "long",
    day: "numeric",
    month: "long",
  }
): string =>
  new Intl.DateTimeFormat(locale, { ...options, timeZone: "UTC" }).format(
    new Date(`${date}T12:00:00Z`)
  );

/**
 * A Prague time of day, HH:mm, as the customer reads it, such as "9:00" or
 * "9:00 AM". The time is formatted on a fixed day in UTC, so no time zone
 * moves it.
 */
export const formatPragueTime = (
  time: string,
  locale: CustomerLocale
): string =>
  new Intl.DateTimeFormat(locale, {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(new Date(`1970-01-01T${time}:00Z`));
