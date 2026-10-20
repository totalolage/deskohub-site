import { Option, Schema } from "effect";
import type { Locale } from "@/features/i18n";
import {
  formatInstantDate,
  formatInstantDateRange,
  formatPlainDate,
  formatPlainDateRange,
} from "@/shared/utils/date-time-format";
import { workspaceSiteConstants } from "@/shared/utils/site-constants";
import {
  plainDateStringSchema,
  temporalInstantToDate,
  temporalPlainDateToDate,
} from "@/shared/utils/temporal";

/** The workspace calendar date (Prague) of an instant. */
export const getWorkspaceDate = (instant: Temporal.Instant) =>
  instant
    .toZonedDateTimeISO(workspaceSiteConstants.location.timeZone)
    .toPlainDate();

export const getCurrentWorkspaceDate = (now = Temporal.Now.instant()) =>
  getWorkspaceDate(now);

export const isTodayOrFutureWorkspaceDate = (date: string) =>
  date >= getCurrentWorkspaceDate().toString();

const reservationDisplayDateFormatOptions: Intl.DateTimeFormatOptions = {
  dateStyle: "full",
  timeZone: workspaceSiteConstants.location.timeZone,
};

const reservationDisplayTimeFormatOptions: Intl.DateTimeFormatOptions = {
  timeStyle: "short",
  timeZone: workspaceSiteConstants.location.timeZone,
};

const reservationDisplayDateTimeFormatOptions: Intl.DateTimeFormatOptions = {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: workspaceSiteConstants.location.timeZone,
};

const decodePlainDate = Schema.decodeUnknownOption(plainDateStringSchema);

const parseReservationInputDate = (date: string) =>
  decodePlainDate(date).pipe(
    Option.map((plainDate) =>
      temporalPlainDateToDate({
        date: Temporal.PlainDate.from(plainDate),
        plainTime: Temporal.PlainTime.from("12:00"),
        timeZone: workspaceSiteConstants.location.timeZone,
      })
    ),
    Option.getOrUndefined
  );

export const formatReservationDisplayDate = (
  date: Temporal.Instant,
  locale: Locale
) =>
  formatInstantDate({
    instant: date,
    locale,
    dateStyle: reservationDisplayDateFormatOptions.dateStyle,
    timeZone: workspaceSiteConstants.location.timeZone,
  });

export const formatReservationDisplayDateRange = (
  start: Temporal.Instant,
  exclusiveEnd: Temporal.Instant,
  locale: Locale
) => {
  const inclusiveEnd = Temporal.Instant.fromEpochMilliseconds(
    exclusiveEnd.epochMilliseconds - 1
  );
  return formatInstantDateRange({
    start,
    end: inclusiveEnd,
    locale,
    dateStyle: reservationDisplayDateFormatOptions.dateStyle,
    timeZone: workspaceSiteConstants.location.timeZone,
  });
};

/** A reservation's calendar date, written out as reservation summaries show it. */
export const formatReservationDisplayPlainDate = (
  date: Temporal.PlainDate,
  locale: Locale
) =>
  formatPlainDate({
    date,
    locale,
    dateStyle: reservationDisplayDateFormatOptions.dateStyle,
  });

/** An inclusive range of reservation calendar dates. */
export const formatReservationDisplayPlainDateRange = (
  start: Temporal.PlainDate,
  end: Temporal.PlainDate,
  locale: Locale
) =>
  formatPlainDateRange({
    start,
    end,
    locale,
    dateStyle: reservationDisplayDateFormatOptions.dateStyle,
  });

export const formatReservationInputDate = (
  date: string,
  locale: Locale,
  fallback = date
) => {
  const parsedDate = parseReservationInputDate(date);

  return parsedDate
    ? new Intl.DateTimeFormat(
        locale,
        reservationDisplayDateFormatOptions
      ).format(parsedDate)
    : fallback;
};

export const formatReservationDisplayTimeRange = (
  start: Temporal.Instant,
  end: Temporal.Instant,
  locale: Locale
) =>
  new Intl.DateTimeFormat(
    locale,
    reservationDisplayTimeFormatOptions
  ).formatRange(temporalInstantToDate(start), temporalInstantToDate(end));

export const formatReservationDisplayDateTime = (
  instant: Temporal.Instant,
  locale: Locale
) =>
  new Intl.DateTimeFormat(
    locale,
    reservationDisplayDateTimeFormatOptions
  ).format(temporalInstantToDate(instant));
