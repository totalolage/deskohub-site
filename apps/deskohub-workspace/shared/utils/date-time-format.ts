import { Option } from "effect";
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

const makeNumericDateFormatter = (locale: Intl.LocalesArgument) =>
  new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "numeric",
    timeZone: "UTC",
    year: "numeric",
  });

type NumericDateField = "day" | "month" | "year";

const isNumericDateField = (type: string): type is NumericDateField =>
  type === "day" || type === "month" || type === "year";

/** The locale's all-numeric date, such as 11/15/2026 (en-US) or 15. 11. 2026 (cs-CZ). */
export const formatNumericPlainDate = ({
  date,
  locale,
}: {
  readonly date: Temporal.PlainDate;
  readonly locale: Intl.LocalesArgument;
}) => makeNumericDateFormatter(locale).format(plainDateToDate(date));

/**
 * The locale's all-numeric date pattern spelled with the given field tokens,
 * such as MM/DD/YYYY (en-US) or DD. MM. RRRR (cs-CZ).
 */
export const formatNumericPlainDatePattern = ({
  locale,
  tokens,
}: {
  readonly locale: Intl.LocalesArgument;
  readonly tokens: Readonly<Record<NumericDateField, string>>;
}) =>
  makeNumericDateFormatter(locale)
    .formatToParts(plainDateToDate(Temporal.PlainDate.from("2024-01-01")))
    .map((part) =>
      isNumericDateField(part.type) ? tokens[part.type] : part.value
    )
    .join("");

const getNumericDateFieldOrder = (locale: Intl.LocalesArgument) =>
  makeNumericDateFormatter(locale)
    .formatToParts(plainDateToDate(Temporal.PlainDate.from("2024-01-01")))
    .map((part) => part.type)
    .filter(isNumericDateField);

/**
 * Reads a typed all-numeric date. A four-digit first number reads as ISO
 * year, month, day; otherwise the numbers follow the locale's order, such as
 * month, day, year in en-US. Dots, slashes, hyphens and spaces separate them,
 * and the year must have four digits so no century is guessed.
 */
export const parseNumericPlainDate = ({
  locale,
  text,
}: {
  readonly locale: Intl.LocalesArgument;
  readonly text: string;
}): Option.Option<Temporal.PlainDate> => {
  const numbers = text
    .trim()
    .replace(/[.\s]+$/, "")
    .split(/\s*[./-]\s*|\s+/);
  if (numbers.length !== 3 || !numbers.every((value) => /^\d+$/.test(value))) {
    return Option.none();
  }

  const order: readonly NumericDateField[] =
    numbers[0]?.length === 4
      ? ["year", "month", "day"]
      : getNumericDateFieldOrder(locale);
  const read = (field: NumericDateField) => numbers[order.indexOf(field)] ?? "";
  const [year, month, day] = [read("year"), read("month"), read("day")];
  if (year.length !== 4 || month.length > 2 || day.length > 2) {
    return Option.none();
  }

  const yearMonth = { year: Number(year), month: Number(month) };
  const dayOfMonth = Number(day);
  return yearMonth.year >= 1 &&
    yearMonth.month >= 1 &&
    yearMonth.month <= 12 &&
    dayOfMonth >= 1 &&
    dayOfMonth <= Temporal.PlainYearMonth.from(yearMonth).daysInMonth
    ? Option.some(Temporal.PlainDate.from({ ...yearMonth, day: dayOfMonth }))
    : Option.none();
};
