import { m } from "@/features/administration/i18n";
import type { Locale } from "@/features/i18n";

/**
 * The English title of a Calendar event without a summary. The
 * administration API returns it as is; screens localize it.
 */
export const untitledCalendarEventTitle = "Untitled event";

export const formatCalendarSaleTitle = (title: string, locale: Locale) =>
  title === untitledCalendarEventTitle
    ? m.discountsCalendarUntitledEvent({}, { locale })
    : title;
