import { DateTime, Option } from "effect";
import type { AppLocale } from "./app-locale";

/**
 * The workspace's time zone. Reservation times are Prague wall-clock times,
 * so they read the same wherever the device is.
 */
export const workspaceTimeZone = "Europe/Prague";

export type InstantStyle = "day" | "date" | "time" | "date-time";

const styleOptions = {
  /** A whole day, written out as the site's account page shows day bookings. */
  day: { dateStyle: "full" },
  date: { dateStyle: "medium" },
  time: { timeStyle: "short" },
  "date-time": { dateStyle: "medium", timeStyle: "short" },
} as const satisfies Record<InstantStyle, Intl.DateTimeFormatOptions>;

/** Reads an ISO 8601 instant; none when the text is not a readable instant. */
export const parseInstant = (iso: string): Option.Option<DateTime.Utc> =>
  DateTime.make(iso);

/** Formats an instant in the locale, as workspace (Prague) time. */
export const formatInstant = (
  instant: DateTime.DateTime,
  locale: AppLocale,
  style: InstantStyle
): string =>
  DateTime.formatIntl(
    instant,
    new Intl.DateTimeFormat(locale, {
      ...styleOptions[style],
      timeZone: workspaceTimeZone,
    })
  );

/**
 * A range's ends, each formatted only as far as it needs; no end when the
 * range is a single whole day.
 */
export interface FormattedInstantRange {
  readonly start: string;
  readonly end: Option.Option<string>;
}

/**
 * Prague calendar days, told apart by one date-only format. Effect's zoned
 * `DateTime.toParts` reads `formatToParts` by position with options (such as
 * `hourCycle`) an engine may not honour; on Android it misread Prague midnight
 * and even the day, so whole days showed as midnight times.
 */
const workspaceDayFormat = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "numeric",
  day: "numeric",
  timeZone: workspaceTimeZone,
});

const workspaceDay = (instant: DateTime.DateTime) =>
  workspaceDayFormat.format(DateTime.toEpochMillis(instant));

const isSameWorkspaceDay = (a: DateTime.DateTime, b: DateTime.DateTime) =>
  workspaceDay(a) === workspaceDay(b);

/** Whether the instant starts a Prague day: a millisecond earlier is the day before. */
const isWorkspaceMidnight = (instant: DateTime.DateTime) =>
  !isSameWorkspaceDay(instant, DateTime.subtract(instant, { milliseconds: 1 }));

/**
 * Formats the Prague days from `start` to the exclusive `end` as whole days:
 * the first day, and the last one when it is another day. An end that doesn't
 * move forward leaves the first day alone.
 */
export const formatWorkspaceDays = (
  start: DateTime.DateTime,
  end: DateTime.DateTime,
  locale: AppLocale
): FormattedInstantRange => {
  const last = DateTime.isGreaterThan(end, start)
    ? DateTime.subtract(end, { milliseconds: 1 })
    : start;
  return {
    start: formatInstant(start, locale, "day"),
    end: isSameWorkspaceDay(start, last)
      ? Option.none()
      : Option.some(formatInstant(last, locale, "day")),
  };
};

/**
 * Formats the ends of a range from `start` to `end` in workspace (Prague)
 * time. Midnight to a later midnight reads as whole days (the end is
 * exclusive, so it shows the last day); a range within one day shows the end
 * as a time only; any other range shows both as date and time.
 */
export const formatInstantRange = (
  start: DateTime.DateTime,
  end: DateTime.DateTime,
  locale: AppLocale
): FormattedInstantRange => {
  if (
    DateTime.isGreaterThan(end, start) &&
    isWorkspaceMidnight(start) &&
    isWorkspaceMidnight(end)
  ) {
    return formatWorkspaceDays(start, end, locale);
  }
  return {
    start: formatInstant(start, locale, "date-time"),
    end: Option.some(
      formatInstant(
        end,
        locale,
        isSameWorkspaceDay(start, end) ? "time" : "date-time"
      )
    ),
  };
};
