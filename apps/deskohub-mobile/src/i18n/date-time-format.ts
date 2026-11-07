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
