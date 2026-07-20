import type { Locale } from "@/features/i18n";
import { workspaceSiteConstants } from "@/shared/utils/site-constants";

const getCurrentPragueDate = () =>
  Temporal.Now.zonedDateTimeISO(workspaceSiteConstants.location.timeZone)
    .toPlainDate()
    .toString();

export const isTodayOrFuturePragueDate = (date: string) =>
  date >= getCurrentPragueDate();

const reservationDisplayDateFormatOptions = {
  dateStyle: "full",
  timeZone: workspaceSiteConstants.location.timeZone,
} satisfies Intl.DateTimeFormatOptions;

export const parseReservationInputDate = (date: Date | string) => {
  if (date instanceof Date) {
    return Number.isNaN(date.getTime()) ? undefined : date;
  }

  if (!date) {
    return undefined;
  }

  const parsedDate = new Date(`${date}T12:00:00`);

  return Number.isNaN(parsedDate.getTime()) ? undefined : parsedDate;
};

export const formatReservationDisplayDate = (
  date: Date | string,
  locale: Locale,
  fallback = typeof date === "string" ? date : ""
) => {
  const parsedDate = parseReservationInputDate(date);

  if (!parsedDate) {
    return fallback;
  }

  return parsedDate.toLocaleDateString(
    locale,
    reservationDisplayDateFormatOptions
  );
};
