import type { Locale } from "@/features/i18n";

const reservationDisplayDateFormatOptions = {
  dateStyle: "full",
  timeZone: "Europe/Prague",
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
