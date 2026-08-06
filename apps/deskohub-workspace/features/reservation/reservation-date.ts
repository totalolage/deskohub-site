import { Option, Schema } from "effect";
import type { Locale } from "@/features/i18n";
import { workspaceSiteConstants } from "@/shared/utils/site-constants";
import {
  plainDateStringSchema,
  temporalInstantToDate,
  temporalPlainDateToDate,
} from "@/shared/utils/temporal";

export const getCurrentWorkspaceDate = (now = Temporal.Now.instant()) =>
  now
    .toZonedDateTimeISO(workspaceSiteConstants.location.timeZone)
    .toPlainDate();

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

const decodePlainDate = Schema.decodeUnknownOption(plainDateStringSchema);

export const parseReservationInputDate = (date: string) =>
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
  new Intl.DateTimeFormat(locale, reservationDisplayDateFormatOptions).format(
    temporalInstantToDate(date)
  );

export const formatReservationDisplayDateRange = (
  start: Temporal.Instant,
  exclusiveEnd: Temporal.Instant,
  locale: Locale
) => {
  const inclusiveEnd = Temporal.Instant.fromEpochMilliseconds(
    exclusiveEnd.epochMilliseconds - 1
  );
  const formatter = new Intl.DateTimeFormat(
    locale,
    reservationDisplayDateFormatOptions
  );

  return formatter.formatRange(
    temporalInstantToDate(start),
    temporalInstantToDate(inclusiveEnd)
  );
};

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
