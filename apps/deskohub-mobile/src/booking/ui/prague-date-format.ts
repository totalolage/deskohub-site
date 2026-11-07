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
