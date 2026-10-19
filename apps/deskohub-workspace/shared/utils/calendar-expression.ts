import {
  type CalendarExpressionType as CalendarExpression,
  type CalendarWeekdayType as CalendarWeekday,
  calendarWeekdays,
  canonicalCalendarExpression,
} from "@deskohub/workspace-admin-api";
import { Cron, Data, DateTime, Effect, Option, Result } from "effect";
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
const toCron = (
  expression: CalendarExpression,
  tz: DateTime.TimeZone = cronTimeZone
) => {
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
    tz,
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

/** `Cron.next` on instants; none when its bounded search finds nothing. */
const nextCronTime = (
  cron: Cron.Cron,
  after: Temporal.Instant
): Option.Option<Temporal.Instant> =>
  Result.try(() => Cron.next(cron, after.epochMilliseconds)).pipe(
    Result.getSuccess,
    Option.map((next) => Temporal.Instant.fromEpochMilliseconds(next.getTime()))
  );

/**
 * The first start after `after` that the spring gap moved, when `after` lies
 * within one gap length past the gap. A wall time the gap skips fires shifted
 * forward by the gap length, which is that wall time read at the offset before
 * the gap. Prague `Cron` steps by wall time and passes them over, since they
 * read earlier than `after`'s wall time; a `Cron` fixed at the offset before
 * the gap steps them in time order.
 */
const nextShiftedGapStart = (
  expression: CalendarExpression,
  grain: Grain,
  after: Temporal.Instant
): Option.Option<Temporal.Instant> => {
  const transition = after
    .add({ nanoseconds: 1 })
    .toZonedDateTimeISO(timeZone)
    .getTimeZoneTransition("previous");
  if (!transition) {
    return Option.none();
  }
  const before = transition.subtract({ nanoseconds: 1 });
  // An autumn transition has a negative gap, which ends before `after`.
  const gapEnd = transition.toInstant().add({
    nanoseconds: transition.offsetNanoseconds - before.offsetNanoseconds,
  });
  if (Temporal.Instant.compare(after, gapEnd) >= 0) {
    return Option.none();
  }
  return nextCronTime(
    toCron(
      expression,
      DateTime.zoneMakeOffset(before.offsetNanoseconds / 1_000_000)
    ),
    after
  ).pipe(
    Option.filter(
      (candidate) =>
        Temporal.Instant.compare(candidate, gapEnd) < 0 &&
        isFireDay(
          expression,
          grain,
          candidate.toZonedDateTimeISO(before.offset).toPlainDate()
        )
    )
  );
};

/**
 * The first period start strictly after `after`, in Prague time, or none
 * when no period starts within eight years. A wall time the spring gap skips
 * starts its period shifted forward by the gap length; a repeated autumn wall
 * time starts a period on its first occurrence only.
 */
export const nextStartWithinHorizon = (
  expression: CalendarExpression,
  after: Temporal.Instant
): Option.Option<Temporal.Instant> => {
  const cron = toCron(expression);
  const grain = grainOf(expression);
  const shifted = nextShiftedGapStart(expression, grain, after);
  // A shifted gap start bounds the search: any later candidate loses to it.
  const limit = Option.getOrElse(shifted, () =>
    after.toZonedDateTimeISO(timeZone).add({ years: horizonYears }).toInstant()
  );
  let cursor = after;
  while (Temporal.Instant.compare(cursor, limit) < 0) {
    const from = cursor;
    const next = nextCronTime(cron, from);
    if (Option.isNone(next)) {
      break;
    }
    const candidate = next.value;
    if (Temporal.Instant.compare(candidate, limit) > 0) {
      break;
    }
    if (Temporal.Instant.compare(candidate, from) <= 0) {
      // Inside a repeated autumn hour Cron.next resolves a later wall time
      // to its first occurrence, which already passed. Only first
      // occurrences start periods, so resume from that wall time's second
      // occurrence, which lies strictly after `from`.
      cursor = candidate
        .toZonedDateTimeISO(timeZone)
        .toPlainDateTime()
        .toZonedDateTime(timeZone, { disambiguation: "later" })
        .toInstant();
      continue;
    }
    const date = candidate.toZonedDateTimeISO(timeZone).toPlainDate();
    if (isFireDay(expression, grain, date)) {
      return Option.some(candidate);
    }
    // Cron.next moves strictly past its input, so this resumes at the
    // next day's first candidate.
    cursor = startOfPragueDay(date.add({ days: 1 })).subtract({
      milliseconds: 1,
    });
  }
  return shifted;
};

/**
 * The first period start strictly after `after`, as `nextStartWithinHorizon`.
 * Fails with `CalendarExpressionNeverOccurs` when none falls within eight
 * years.
 */
export const nextStart = (
  expression: CalendarExpression,
  after: Temporal.Instant
): Effect.Effect<Temporal.Instant, CalendarExpressionNeverOccurs> =>
  Option.match(nextStartWithinHorizon(expression, after), {
    onNone: () =>
      Effect.fail(new CalendarExpressionNeverOccurs({ expression, after })),
    onSome: Effect.succeed,
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
