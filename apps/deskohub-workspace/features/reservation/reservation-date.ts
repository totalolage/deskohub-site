import type { Locale } from "@/features/i18n";
import { workspaceSiteConstants } from "@/shared/utils/site-constants";

export const reservationTimeZone = workspaceSiteConstants.location.timeZone;

const getCurrentPragueDate = () =>
  Temporal.Now.zonedDateTimeISO(reservationTimeZone).toPlainDate().toString();

export const isTodayOrFuturePragueDate = (date: string) =>
  date >= getCurrentPragueDate();

const reservationDisplayDateFormatOptions = {
  dateStyle: "full",
  timeZone: reservationTimeZone,
} satisfies Intl.DateTimeFormatOptions;

const reservationDisplayTimeFormatOptions = {
  timeStyle: "short",
  timeZone: reservationTimeZone,
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

export const formatReservationDisplayTimeRange = (
  start: Date,
  end: Date,
  locale: Locale,
  fallback = ""
) => {
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return fallback;
  }

  const formatter = new Intl.DateTimeFormat(
    locale,
    reservationDisplayTimeFormatOptions
  );
  return `${formatter.format(start)} - ${formatter.format(end)}`;
};
