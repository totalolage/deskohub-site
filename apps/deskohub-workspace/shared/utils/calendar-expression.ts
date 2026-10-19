import {
  type CalendarExpressionType as CalendarExpression,
  type CalendarWeekdayType as CalendarWeekday,
  calendarWeekdays,
  canonicalCalendarExpression,
} from "@deskohub/workspace-admin-api";
import { Cron, Data, DateTime, Effect } from "effect";
import { workspaceSiteConstants } from "./site-constants";
import { currentInstant } from "./temporal";

const timeZone = workspaceSiteConstants.location.timeZone;
const cronTimeZone = DateTime.zoneMakeNamedUnsafe(timeZone);

/**
 * How far ahead an expression must occur. Eight years cover Feb 29 and ISO
 * week 53, which recur at most every 8 and 6 years.
 */
const horizonYears = 8;

/** The expression has no period start within the next eight years. */
export class CalendarExpressionNeverOccurs extends Data.TaggedError(
  "CalendarExpressionNeverOccurs"
)<{
  readonly expression: CalendarExpression;
  readonly after: Temporal.Instant;
  readonly cause?: unknown;
}> {}

type Grain = "minute" | "hour" | "day" | "week" | "month";

/** The finest given field: each period of the expression is one such unit. */
const grainOf = (expression: CalendarExpression): Grain => {
  if (expression.minutes) {
    return "minute";
  }
  if (expression.hours) {
    return "hour";
  }
  if (
    expression.weekdays ||
    expression.daysOfMonth ||
    expression.weekdayOccurrences
  ) {
    return "day";
  }
  return expression.weeksOfYear ? "week" : "month";
};

/** JavaScript weekday numbering, as `Cron` uses it: Sunday is 0. */
const cronWeekday = (weekday: CalendarWeekday) =>
  (calendarWeekdays.indexOf(weekday) + 1) % 7;

/** Temporal weekday numbering: Monday is 1. */
const isoWeekday = (weekday: CalendarWeekday) =>
  calendarWeekdays.indexOf(weekday) + 1;

/**
 * `Cron` steps time of day, months and Prague DST. It receives day-of-month
 * or weekday sets only when they alone constrain the day, so its OR rule for
 * both never applies; `dayMatches` checks every day field anyway.
 */
const toCron = (expression: CalendarExpression) => {
  const { daysOfMonth, weekdays, weekdayOccurrences } = expression;
  const numberedDays =
    daysOfMonth?.every((day) => day !== "last") &&
    !weekdays &&
    !weekdayOccurrences
      ? daysOfMonth
      : [];
  const cronWeekdays =
    weekdays && numberedDays.length === 0 ? weekdays.map(cronWeekday) : [];
  return Cron.make({
    seconds: [0],
    minutes: expression.minutes ?? [0],
    hours: expression.hours ?? (expression.minutes ? [] : [0]),
    days: numberedDays,
    months: expression.months ?? [],
    weekdays: cronWeekdays,
    tz: cronTimeZone,
  });
};

/** Whether a Prague calendar day satisfies every given day, week and month field. */
const dayMatches = (
  expression: CalendarExpression,
  date: Temporal.PlainDate
): boolean =>
  (expression.weekdays?.some(
    (weekday) => isoWeekday(weekday) === date.dayOfWeek
  ) ??
    true) &&
  (expression.daysOfMonth?.some((day) =>
    day === "last" ? date.day === date.daysInMonth : date.day === day
  ) ??
    true) &&
  (expression.weekdayOccurrences?.some(
    ({ occurrence, weekday }) =>
      isoWeekday(weekday) === date.dayOfWeek &&
      (occurrence === "last"
        ? date.day + 7 > date.daysInMonth
        : Math.ceil(date.day / 7) === occurrence)
  ) ??
    true) &&
  (expression.weeksOfYear?.includes(date.weekOfYear ?? 0) ?? true) &&
  (expression.months?.includes(date.month) ?? true);

/** The ISO week or the month containing `date`, as a comparable key. */
const periodGroup = (grain: "week" | "month", date: Temporal.PlainDate) =>
  grain === "week"
    ? `${date.yearOfWeek}-W${date.weekOfYear}`
    : `${date.year}-${date.month}`;

/**
 * Whether `date` carries period starts. At week or month grain only the first
 * matching day of each week or month does; the matching days of one period
 * are contiguous, so that is the matching day whose previous day doesn't
 * match or lies in another period.
 */
const isFireDay = (
  expression: CalendarExpression,
  grain: Grain,
  date: Temporal.PlainDate
): boolean => {
  if (!dayMatches(expression, date)) {
    return false;
  }
  if (grain !== "week" && grain !== "month") {
    return true;
  }
  const previous = date.subtract({ days: 1 });
  return (
    periodGroup(grain, previous) !== periodGroup(grain, date) ||
    !dayMatches(expression, previous)
  );
};

const startOfPragueDay = (date: Temporal.PlainDate) =>
  date.toZonedDateTime({ timeZone }).toInstant();

/**
 * The first period start strictly after `after`, in Prague time. Fails with
 * `CalendarExpressionNeverOccurs` when none falls within eight years.
 */
export const nextStart = (
  expression: CalendarExpression,
  after: Temporal.Instant
): Effect.Effect<Temporal.Instant, CalendarExpressionNeverOccurs> =>
  Effect.gen(function* () {
    const neverOccurs = (cause?: unknown) =>
      new CalendarExpressionNeverOccurs({ expression, after, cause });
    const cron = toCron(expression);
    const grain = grainOf(expression);
    const limit = after
      .toZonedDateTimeISO(timeZone)
      .add({ years: horizonYears })
      .toInstant();
    let cursor = after;
    while (Temporal.Instant.compare(cursor, limit) < 0) {
      const from = cursor;
      const candidate = Temporal.Instant.fromEpochMilliseconds(
        (yield* Effect.try({
          try: () => Cron.next(cron, from.epochMilliseconds),
          catch: neverOccurs,
        })).getTime()
      );
      if (Temporal.Instant.compare(candidate, limit) > 0) {
        break;
      }
      const date = candidate.toZonedDateTimeISO(timeZone).toPlainDate();
      if (isFireDay(expression, grain, date)) {
        return candidate;
      }
      // Cron.next moves strictly past its input, so this resumes at the
      // next day's first candidate.
      cursor = startOfPragueDay(date.add({ days: 1 })).subtract({
        milliseconds: 1,
      });
    }
    return yield* Effect.fail(neverOccurs());
  });

/**
 * Whether `at` lies inside a period of the expression. Fields finer than the
 * given ones are wildcards: "hour 10" holds all of 10:00–10:59 and
 * "December" all of December.
 */
export const holds = (
  expression: CalendarExpression,
  at: Temporal.Instant
): boolean => {
  const zoned = at.toZonedDateTimeISO(timeZone);
  return (
    dayMatches(expression, zoned.toPlainDate()) &&
    (expression.hours?.includes(zoned.hour) ?? true) &&
    (expression.minutes?.includes(zoned.minute) ?? true)
  );
};

export interface CalendarFrequency {
  /** The most period starts any one hour can hold. */
  readonly maxFiresPerHour: number;
  /** Some hour can hold more than one period start. */
  readonly firesMoreThanHourly: boolean;
}

/**
 * How often a schedule can fire. At hour grain or coarser a period starts at
 * most once an hour; at minute grain each listed minute starts its own period
 * in every matching hour.
 */
export const calendarFrequency = (
  expression: CalendarExpression
): CalendarFrequency => {
  const maxFiresPerHour = expression.minutes?.length ?? 1;
  return { maxFiresPerHour, firesMoreThanHourly: maxFiresPerHour > 1 };
};

/**
 * The expression as stored, once it is known to occur within eight years of
 * now. The schema already checked ranges, unique values and at least one
 * field; any frequency is allowed.
 */
export const validateCalendarExpression = (
  expression: CalendarExpression
): Effect.Effect<CalendarExpression, CalendarExpressionNeverOccurs> =>
  currentInstant.pipe(
    Effect.flatMap((now) => nextStart(expression, now)),
    Effect.as(canonicalCalendarExpression(expression))
  );
