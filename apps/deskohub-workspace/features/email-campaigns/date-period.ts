import type { DatePeriodType } from "@deskohub/workspace-admin-api";
import { Match, Option } from "effect";
import { workspaceSiteConstants } from "@/shared/utils";
import type { AudienceEvaluationContext } from "./backend/audience-evaluation-context";

export type DatePeriod = DatePeriodType;

/**
 * An instant interval. The start is inclusive. A calendar-day end is the
 * next Prague midnight, exclusive (`startsBefore`); an end at the evaluation
 * time includes that instant (`startsAtOrBefore`). A missing bound is open.
 */
export type DatePeriodBounds = {
  readonly startsAtOrAfter?: Temporal.Instant;
} & (
  | {
      readonly startsBefore?: Temporal.Instant;
      readonly startsAtOrBefore?: never;
    }
  | {
      readonly startsAtOrBefore: Temporal.Instant;
      readonly startsBefore?: never;
    }
);

const { timeZone } = workspaceSiteConstants.location;

const startOfDay = (date: string) =>
  Temporal.PlainDate.from(date)
    .toZonedDateTime({ timeZone, plainTime: Temporal.PlainTime.from("00:00") })
    .toInstant();

const startOfNextDay = (date: string) =>
  startOfDay(Temporal.PlainDate.from(date).add({ days: 1 }).toString());

const unitDurations = {
  day: (count: number) => ({ days: count }),
  week: (count: number) => ({ weeks: count }),
  month: (count: number) => ({ months: count }),
  year: (count: number) => ({ years: count }),
} as const;

const stepped = (
  instant: Temporal.Instant,
  direction: "subtract" | "add",
  duration: Temporal.DurationLike
) => instant.toZonedDateTimeISO(timeZone)[direction](duration).toInstant();

/**
 * The instants a period covers in an evaluation context. Day bounds are
 * Prague midnights; "last N units" and trigger windows step through the
 * Prague calendar, so a month keeps its length and a DST change shifts no
 * day. "Last N", "since" and "any time so far" end at `now`, inclusive;
 * "from … to" and "until" end before the next Prague midnight; any time and
 * "onward" leave the end open. A trigger window runs from or to the trigger
 * instant, inclusive; without a trigger, the evaluation time stands in for it.
 */
export const datePeriodBounds = (
  period: DatePeriod,
  { now, trigger }: AudienceEvaluationContext
): DatePeriodBounds =>
  Match.value(period).pipe(
    Match.tagsExhaustive({
      AnyTime: () => ({}),
      Past: () => ({ startsAtOrBefore: now }),
      Last: ({ count, unit }) => ({
        startsAtOrAfter: stepped(now, "subtract", unitDurations[unit](count)),
        startsAtOrBefore: now,
      }),
      Range: ({ from, to }) => ({
        startsAtOrAfter: startOfDay(from),
        startsBefore: startOfNextDay(to),
      }),
      Since: ({ date }) => ({
        startsAtOrAfter: startOfDay(date),
        startsAtOrBefore: now,
      }),
      Onward: ({ date }) => ({ startsAtOrAfter: startOfDay(date) }),
      Until: ({ date }) => ({ startsBefore: startOfNextDay(date) }),
      TriggerWindow: ({ side, count, unit }) => {
        const at = trigger.pipe(
          Option.map((event) => event.at),
          Option.getOrElse(() => now)
        );
        const duration = unitDurations[unit](count);
        return Match.value(side).pipe(
          Match.when("before", () => ({
            startsAtOrAfter: stepped(at, "subtract", duration),
            startsAtOrBefore: at,
          })),
          Match.when("after", () => ({
            startsAtOrAfter: at,
            startsAtOrBefore: stepped(at, "add", duration),
          })),
          Match.exhaustive
        );
      },
    })
  );

/** Whether the bounds leave both ends open, as any time does. */
export const isUnboundedPeriod = (bounds: DatePeriodBounds): boolean =>
  bounds.startsAtOrAfter === undefined &&
  bounds.startsBefore === undefined &&
  bounds.startsAtOrBefore === undefined;

/** The bounds without anything after `instant`, which they include. */
export const datePeriodBoundsEndingBy = (
  bounds: DatePeriodBounds,
  instant: Temporal.Instant
): DatePeriodBounds => {
  const end = bounds.startsBefore ?? bounds.startsAtOrBefore;
  return end !== undefined && Temporal.Instant.compare(end, instant) <= 0
    ? bounds
    : {
        ...(bounds.startsAtOrAfter && {
          startsAtOrAfter: bounds.startsAtOrAfter,
        }),
        startsAtOrBefore: instant,
      };
};

/** Whether an instant lies in the bounds. */
export const isWithinDatePeriodBounds = (
  bounds: DatePeriodBounds,
  instant: Temporal.Instant
): boolean =>
  (bounds.startsAtOrAfter === undefined ||
    Temporal.Instant.compare(instant, bounds.startsAtOrAfter) >= 0) &&
  (bounds.startsBefore === undefined ||
    Temporal.Instant.compare(instant, bounds.startsBefore) < 0) &&
  (bounds.startsAtOrBefore === undefined ||
    Temporal.Instant.compare(instant, bounds.startsAtOrBefore) <= 0);
