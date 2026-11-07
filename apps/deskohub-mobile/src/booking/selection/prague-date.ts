import type { CustomerPlainDate } from "@deskohub/workspace-customer-api";
import { Option } from "effect";

/**
 * A Prague calendar date, YYYY-MM-DD, as the booking contract carries it.
 * Calendar arithmetic on it ignores time zones; only "today" and the
 * instants of Prague midnights depend on Europe/Prague.
 */
export type PragueDate = typeof CustomerPlainDate.Type;

/** A Prague calendar month; `month` runs 1..12. */
export type PragueMonth = { readonly year: number; readonly month: number };

/** The Prague wall-clock date and time at one instant. */
export type PragueDateTime = {
  readonly date: PragueDate;
  readonly hour: number;
  readonly minute: number;
};

const pragueTimeZone = "Europe/Prague";
const millisecondsPerHour = 60 * 60 * 1000;

// en-US numeric parts, read by type, so the locale's ordering and literals
// don't matter. Some engines print midnight as hour 24 with hour12: false.
const pragueParts = new Intl.DateTimeFormat("en-US", {
  timeZone: pragueTimeZone,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const pad = (value: number, length = 2) => String(value).padStart(length, "0");

const formatDate = (year: number, month: number, day: number): PragueDate =>
  `${pad(year, 4)}-${pad(month)}-${pad(day)}`;

const dateParts = (date: PragueDate) => {
  const [year = 0, month = 1, day = 1] = date.split("-").map(Number);
  return { year, month, day };
};

const utcDayOf = (date: PragueDate) => {
  const { year, month, day } = dateParts(date);
  return new Date(Date.UTC(year, month - 1, day));
};

const fromUtcDay = (value: Date): PragueDate =>
  formatDate(
    value.getUTCFullYear(),
    value.getUTCMonth() + 1,
    value.getUTCDate()
  );

/** The Prague date and time of day at `instant`. */
export const pragueDateTimeAt = (instant: Date): PragueDateTime => {
  const parts = Object.fromEntries(
    pragueParts
      .formatToParts(instant)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)])
  );
  return {
    date: formatDate(parts.year ?? 0, parts.month ?? 1, parts.day ?? 1),
    hour: (parts.hour ?? 0) % 24,
    minute: parts.minute ?? 0,
  };
};

/** Today's date in Prague at `instant`. */
export const pragueToday = (instant: Date): PragueDate =>
  pragueDateTimeAt(instant).date;

/** `date` moved by `days` calendar days, which may be negative. */
export const addDays = (date: PragueDate, days: number): PragueDate => {
  const value = utcDayOf(date);
  value.setUTCDate(value.getUTCDate() + days);
  return fromUtcDay(value);
};

/**
 * `date` moved by `months` calendar months, kept within the target month:
 * 31 January plus one month is the last day of February.
 */
export const addMonths = (date: PragueDate, months: number): PragueDate => {
  const { year, month, day } = dateParts(date);
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)
  ).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return fromUtcDay(target);
};

/** Calendar days from `from` to `to`; negative when `to` is earlier. */
export const daysBetween = (from: PragueDate, to: PragueDate): number =>
  Math.round((utcDayOf(to).getTime() - utcDayOf(from).getTime()) / 86_400_000);

/**
 * The instant Prague's wall clock shows `dateTime`. A time the spring change
 * skips resolves to an instant an hour off.
 */
export const pragueInstant = ({ date, hour, minute }: PragueDateTime): Date => {
  const wallClock = utcDayOf(date).getTime() + (hour * 60 + minute) * 60_000;
  const offsetAt = (instant: number) => {
    const local = pragueDateTimeAt(new Date(instant));
    const { year, month, day } = dateParts(local.date);
    return (
      Date.UTC(year, month - 1, day, local.hour, local.minute) -
      Math.floor(instant / 60_000) * 60_000
    );
  };
  // Prague changes its offset at most once a day, so two rounds settle on the
  // offset in force at that wall-clock time.
  const firstGuess = wallClock - offsetAt(wallClock);
  return new Date(wallClock - offsetAt(firstGuess));
};

/** The instant Prague's `date` begins. */
export const pragueMidnight = (date: PragueDate): Date =>
  pragueInstant({ date, hour: 0, minute: 0 });

/**
 * Elapsed hours from the start of Prague's `from` to the start of Prague's
 * `to`: 24 a day, 23 or 25 across a daylight-saving change.
 */
export const hoursBetweenMidnights = (
  from: PragueDate,
  to: PragueDate
): number =>
  Math.round(
    (pragueMidnight(to).getTime() - pragueMidnight(from).getTime()) /
      millisecondsPerHour
  );

/** The Prague month `date` falls in. */
export const monthOf = (date: PragueDate): PragueMonth => {
  const { year, month } = dateParts(date);
  return { year, month };
};

/** `month` moved by `months` calendar months. */
export const addMonthsToMonth = (
  { year, month }: PragueMonth,
  months: number
): PragueMonth => monthOf(addMonths(formatDate(year, month, 1), months));

/**
 * The weeks of `month` for a calendar, Monday first. Each week has seven
 * cells; days outside the month are empty.
 */
export const monthWeeks = ({
  year,
  month,
}: PragueMonth): ReadonlyArray<ReadonlyArray<Option.Option<PragueDate>>> => {
  const first = formatDate(year, month, 1);
  const dayCount = new Date(Date.UTC(year, month, 0)).getUTCDate();
  // getUTCDay counts from Sunday; a Monday-first week puts Sunday last.
  const leading = (utcDayOf(first).getUTCDay() + 6) % 7;
  const cellCount = Math.ceil((leading + dayCount) / 7) * 7;
  const cells = Array.from({ length: cellCount }, (_, index) => {
    const day = index - leading + 1;
    return day >= 1 && day <= dayCount
      ? Option.some(formatDate(year, month, day))
      : Option.none<PragueDate>();
  });
  return Array.from({ length: cellCount / 7 }, (_, week) =>
    cells.slice(week * 7, week * 7 + 7)
  );
};
