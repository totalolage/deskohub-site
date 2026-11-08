import { DateTime, type Option } from "effect";
import type { AppLocale } from "./app-locale";

/**
 * The workspace's time zone. Reservation times are Prague wall-clock times,
 * so they read the same wherever the device is.
 */
export const workspaceTimeZone = "Europe/Prague";

export type InstantStyle = "date" | "time" | "date-time";

const styleOptions = {
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

/** A time range's two ends, each formatted only as far as it needs. */
export interface FormattedInstantRange {
  readonly start: string;
  readonly end: string;
}

const workspaceWallClock = (instant: DateTime.DateTime) =>
  DateTime.toParts(
    DateTime.makeZonedUnsafe(instant, { timeZone: workspaceTimeZone })
  );

const isWorkspaceMidnight = (instant: DateTime.DateTime) => {
  const { hour, minute, second, millisecond } = workspaceWallClock(instant);
  return hour === 0 && minute === 0 && second === 0 && millisecond === 0;
};

const isSameWorkspaceDay = (a: DateTime.DateTime, b: DateTime.DateTime) => {
  const first = workspaceWallClock(a);
  const second = workspaceWallClock(b);
  return (
    first.year === second.year &&
    first.month === second.month &&
    first.day === second.day
  );
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
    return {
      start: formatInstant(start, locale, "date"),
      end: formatInstant(
        DateTime.subtract(end, { milliseconds: 1 }),
        locale,
        "date"
      ),
    };
  }
  return {
    start: formatInstant(start, locale, "date-time"),
    end: formatInstant(
      end,
      locale,
      isSameWorkspaceDay(start, end) ? "time" : "date-time"
    ),
  };
};
