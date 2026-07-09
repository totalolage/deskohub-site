import type { Locale } from "@/features/i18n";
import {
  dateToTemporalPlainDate,
  type TemporalInstant,
  type TemporalPlainDate,
  temporalInstantToDate,
  temporalPlainDateToDate,
  toTemporalInstant,
} from "@/shared/utils/temporal";

type ReservationDisplayDate = Date | TemporalInstant | TemporalPlainDate;
type ReservationDisplayInstant = Date | TemporalInstant;

export const reservationTimeZone = "Europe/Prague";
const calendarPlainTime = Temporal.PlainTime.from("12:00");

const reservationDisplayDateFormatOptions = {
  dateStyle: "full",
  timeZone: reservationTimeZone,
} satisfies Intl.DateTimeFormatOptions;

const reservationDisplayTimeFormatOptions = {
  timeStyle: "short",
  timeZone: reservationTimeZone,
} satisfies Intl.DateTimeFormatOptions;

const reservationDisplayDateTimeFormatOptions = {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: reservationTimeZone,
} satisfies Intl.DateTimeFormatOptions;

const toReservationPlainDate = (date: ReservationDisplayDate) => {
  const instant =
    date instanceof Temporal.PlainDate ? undefined : toTemporalInstant(date);

  return date instanceof Temporal.PlainDate
    ? date
    : instant?.toZonedDateTimeISO(reservationTimeZone).toPlainDate();
};

export const parseReservationInputDate = (date: string) => {
  try {
    return Temporal.PlainDate.from(date);
  } catch {
    return undefined;
  }
};

export const formatReservationInputDate = (date: Temporal.PlainDate) =>
  date.toString();

export const reservationPlainDateToCalendarDate = (date: Temporal.PlainDate) =>
  temporalPlainDateToDate({
    date,
    plainTime: calendarPlainTime,
    timeZone: reservationTimeZone,
  });

export const calendarDateToReservationPlainDate = (date: Date) =>
  dateToTemporalPlainDate({ date, timeZone: reservationTimeZone });

export const formatReservationDisplayDate = (
  date: ReservationDisplayDate,
  locale: Locale,
  fallback = ""
) => {
  const plainDate = toReservationPlainDate(date);

  if (!plainDate) return fallback;

  return plainDate.toLocaleString(locale, reservationDisplayDateFormatOptions);
};

export const formatReservationDisplayTimeRange = (
  start: ReservationDisplayInstant,
  end: ReservationDisplayInstant,
  locale: Locale,
  fallback = ""
) => {
  const startInstant = toTemporalInstant(start);
  const endInstant = toTemporalInstant(end);

  if (!startInstant || !endInstant) return fallback;

  const startDateTime = startInstant.toZonedDateTimeISO(reservationTimeZone);
  const endDateTime = endInstant.toZonedDateTimeISO(reservationTimeZone);
  const parsedStart = temporalInstantToDate(startInstant);
  const parsedEnd = temporalInstantToDate(endInstant);

  if (startDateTime.toPlainDate().equals(endDateTime.toPlainDate())) {
    const timeFormat = new Intl.DateTimeFormat(
      locale,
      reservationDisplayTimeFormatOptions
    );

    return `${timeFormat.format(parsedStart)} - ${timeFormat.format(parsedEnd)}`;
  }

  const dateTimeFormat = new Intl.DateTimeFormat(
    locale,
    reservationDisplayDateTimeFormatOptions
  );

  return `${dateTimeFormat.format(parsedStart)} - ${dateTimeFormat.format(parsedEnd)}`;
};
