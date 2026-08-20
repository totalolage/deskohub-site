import { temporalInstantToDate, temporalPlainDateToDate } from "./temporal";

interface DateFormatOptions {
  readonly locale: Intl.LocalesArgument;
  readonly dateStyle?: Intl.DateTimeFormatOptions["dateStyle"];
}

interface InstantDateFormatOptions extends DateFormatOptions {
  readonly timeZone: string;
}

const makeDateFormatter = ({
  locale,
  dateStyle = "medium",
  timeZone,
}: InstantDateFormatOptions) =>
  new Intl.DateTimeFormat(locale, { dateStyle, timeZone });

export const formatInstantDate = ({
  instant,
  ...options
}: InstantDateFormatOptions & { readonly instant: Temporal.Instant }) =>
  makeDateFormatter(options).format(temporalInstantToDate(instant));

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
