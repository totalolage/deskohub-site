import { temporalInstantToDate, temporalPlainDateToDate } from "./temporal";

interface DateFormatOptions {
  readonly locale: Intl.LocalesArgument;
  readonly dateStyle?: Intl.DateTimeFormatOptions["dateStyle"];
}

interface InstantDateFormatOptions extends DateFormatOptions {
  readonly timeZone: string;
}

interface InstantDateTimeFormatOptions extends InstantDateFormatOptions {
  readonly timeStyle?: Intl.DateTimeFormatOptions["timeStyle"];
}

const makeDateFormatter = ({
  locale,
  dateStyle = "medium",
  timeStyle,
  timeZone,
}: InstantDateTimeFormatOptions) =>
  new Intl.DateTimeFormat(locale, { dateStyle, timeStyle, timeZone });

/**
 * Replaces the narrow no-break and thin spaces that Node's ICU puts in times
 * and ranges with the plain spaces Chromium renders, so text formatted on
 * both the server and the client hydrates.
 */
export const withPlainSpaces = (text: string) =>
  text.replace(/[\u202F\u2009]/g, " ");

export const formatInstantDate = ({
  instant,
  ...options
}: InstantDateFormatOptions & { readonly instant: Temporal.Instant }) =>
  makeDateFormatter(options).format(temporalInstantToDate(instant));

/**
 * The instant's date and time of day. Format it on the server: Node and
 * browsers separate the time with different spaces, so a client-side value
 * fails hydration.
 */
export const formatInstantDateTime = ({
  instant,
  timeStyle = "short",
  ...options
}: InstantDateTimeFormatOptions & { readonly instant: Temporal.Instant }) =>
  makeDateFormatter({ ...options, timeStyle }).format(
    temporalInstantToDate(instant)
  );

/**
 * The instant's time of day. Format it on the server or only in content the
 * client renders after hydration: Node and browsers separate the time with
 * different spaces, so a value rendered on both sides fails hydration.
 */
export const formatInstantTime = ({
  instant,
  locale,
  timeZone,
}: {
  readonly instant: Temporal.Instant;
  readonly locale: Intl.LocalesArgument;
  readonly timeZone: string;
}) =>
  new Intl.DateTimeFormat(locale, { timeStyle: "short", timeZone }).format(
    temporalInstantToDate(instant)
  );

export const formatInstantDateRange = ({
  start,
  end,
  ...options
}: InstantDateFormatOptions & {
  readonly start: Temporal.Instant;
  readonly end: Temporal.Instant;
}) =>
  makeDateFormatter(options).formatRange(
    temporalInstantToDate(start),
    temporalInstantToDate(end)
  );

const plainDateToDate = (date: Temporal.PlainDate) =>
  temporalPlainDateToDate({
    date,
    plainTime: Temporal.PlainTime.from("12:00"),
    timeZone: "UTC",
  });

export const formatPlainDate = ({
  date,
  ...options
}: DateFormatOptions & { readonly date: Temporal.PlainDate }) =>
  makeDateFormatter({ ...options, timeZone: "UTC" }).format(
    plainDateToDate(date)
  );

export const formatPlainDateRange = ({
  start,
  end,
  ...options
}: DateFormatOptions & {
  readonly start: Temporal.PlainDate;
  readonly end: Temporal.PlainDate;
}) =>
  makeDateFormatter({ ...options, timeZone: "UTC" }).formatRange(
    plainDateToDate(start),
    plainDateToDate(end)
  );

/** The locale's short name for an ISO weekday, 1 (Monday) to 7 (Sunday). */
export const formatWeekday = ({
  isoDay,
  locale,
}: {
  readonly isoDay: number;
  readonly locale: Intl.LocalesArgument;
}) =>
  new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" }).format(
    // 2024-01-01 is a Monday, so `isoDay` 1–7 picks Monday–Sunday.
    plainDateToDate(
      Temporal.PlainDate.from({ year: 2024, month: 1, day: isoDay })
    )
  );
