import type { Locale } from "@/features/i18n";
import { workspaceSiteConstants } from "@/shared/utils/site-constants";
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

export const reservationTimeZone = workspaceSiteConstants.location.timeZone;

const reservationDisplayDateFormatOptions: Intl.DateTimeFormatOptions = {
  dateStyle: "full",
  timeZone: reservationTimeZone,
};

const reservationDisplayTimeFormatOptions: Intl.DateTimeFormatOptions = {
  timeStyle: "short",
  timeZone: reservationTimeZone,
};

const reservationDisplayDateTimeFormatOptions: Intl.DateTimeFormatOptions = {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: reservationTimeZone,
};

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
    plainTime: Temporal.PlainTime.from("12:00"),
    timeZone: reservationTimeZone,
  });

export const calendarDateToReservationPlainDate = (date: Date) =>
  dateToTemporalPlainDate({ date, timeZone: reservationTimeZone });

export const reservationInputDateToCalendarDate = (date: string) => {
  const plainDate = parseReservationInputDate(date);
  return plainDate ? reservationPlainDateToCalendarDate(plainDate) : undefined;
};

export const formatReservationDisplayDate = (
  date: ReservationDisplayDate,
  locale: Locale,
  fallback = ""
) => {
  const plainDate = toReservationPlainDate(date);

  if (!plainDate) return fallback;

  return plainDate.toLocaleString(locale, reservationDisplayDateFormatOptions);
};

export const formatReservationInputDisplayDate = (
  date: string,
  locale: Locale,
  fallback = ""
) => {
  const plainDate = parseReservationInputDate(date);
  return plainDate
    ? formatReservationDisplayDate(plainDate, locale, fallback)
    : fallback;
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
