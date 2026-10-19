import { describe, expect, test } from "bun:test";
import { Option } from "effect";
import { audienceEvaluationAt } from "./backend/audience-evaluation-context";
import {
  type DatePeriod,
  datePeriodBounds,
  datePeriodBoundsEndingBy,
  isWithinDatePeriodBounds,
} from "./date-period";

/** 12:00 in Prague (CEST). */
const now = Temporal.Instant.from("2026-10-15T10:00:00Z");
const millisecond = { milliseconds: 1 } as const;

const within = (period: DatePeriod, instant: Temporal.Instant) =>
  isWithinDatePeriodBounds(
    datePeriodBounds(period, audienceEvaluationAt(now)),
    instant
  );

/** The bounds of a trigger window around a trigger at `at`, evaluated at `now`. */
const triggerWindowBounds = (
  at: string,
  side: "before" | "after",
  count: number,
  unit: "day" | "week" | "month"
) =>
  datePeriodBounds(
    { _tag: "TriggerWindow", side, count, unit },
    {
      ...audienceEvaluationAt(now),
      trigger: Option.some({
        kind: "schedule",
        at: Temporal.Instant.from(at),
        reservationId: Option.none(),
      }),
    }
  );

describe("datePeriodBounds", () => {
  test.each<DatePeriod>([
    { _tag: "Last", count: 1, unit: "day" },
    { _tag: "Since", date: "2026-10-01" },
  ])("includes the evaluation time in %o, and nothing after it", (period) => {
    expect(within(period, now)).toBe(true);
    expect(within(period, now.add(millisecond))).toBe(false);
  });

  test("starts the last N units at their first instant, inclusive", () => {
    const start = Temporal.Instant.from("2026-10-14T10:00:00Z");
    const lastDay: DatePeriod = { _tag: "Last", count: 1, unit: "day" };
    expect(within(lastDay, start)).toBe(true);
    expect(within(lastDay, start.subtract(millisecond))).toBe(false);
  });

  test.each<DatePeriod>([
    { _tag: "Until", date: "2026-10-20" },
    { _tag: "Range", from: "2026-10-01", to: "2026-10-20" },
  ])("ends %o before the next Prague midnight", (period) => {
    const nextMidnight = Temporal.Instant.from("2026-10-20T22:00:00Z");
    expect(within(period, nextMidnight.subtract(millisecond))).toBe(true);
    expect(within(period, nextMidnight)).toBe(false);
  });

  test("leaves from-onward open into the future", () => {
    expect(
      within({ _tag: "Onward", date: "2026-10-01" }, now.add({ hours: 1000 }))
    ).toBe(true);
  });

  test("ends any time so far at the evaluation time, with no start", () => {
    const past: DatePeriod = { _tag: "Past" };
    expect(datePeriodBounds(past, audienceEvaluationAt(now))).toEqual({
      startsAtOrBefore: now,
    });
    expect(within(past, now)).toBe(true);
    expect(within(past, Temporal.Instant.from("2001-01-01T00:00:00Z"))).toBe(
      true
    );
    expect(within(past, now.add(millisecond))).toBe(false);
  });

  test.each([
    // A week before a trigger just after the switch to CET starts at the
    // same Prague time, an hour less than seven days earlier.
    [
      "2026-10-26T09:00:00Z",
      "before",
      1,
      "week",
      "2026-10-19T08:00:00Z",
      "2026-10-26T09:00:00Z",
    ],
    // A day after a trigger before the switch ends 25 hours later.
    [
      "2026-10-24T08:00:00Z",
      "after",
      1,
      "day",
      "2026-10-24T08:00:00Z",
      "2026-10-25T09:00:00Z",
    ],
    // A month before 31 March ends on the last day of February, across the
    // switch to CEST.
    [
      "2026-03-31T10:00:00Z",
      "before",
      1,
      "month",
      "2026-02-28T11:00:00Z",
      "2026-03-31T10:00:00Z",
    ],
    // A month after 31 January ends on 28 February.
    [
      "2026-01-31T11:00:00Z",
      "after",
      1,
      "month",
      "2026-01-31T11:00:00Z",
      "2026-02-28T11:00:00Z",
    ],
  ] as const)(
    "bounds a trigger at %s within %s %i %s from %s through %s",
    (at, side, count, unit, start, end) => {
      expect(triggerWindowBounds(at, side, count, unit)).toEqual({
        startsAtOrAfter: Temporal.Instant.from(start),
        startsAtOrBefore: Temporal.Instant.from(end),
      });
    }
  );

  test("includes both ends of a trigger window, and nothing outside it", () => {
    const bounds = triggerWindowBounds(
      "2026-10-01T10:00:00Z",
      "after",
      2,
      "week"
    );
    const start = Temporal.Instant.from("2026-10-01T10:00:00Z");
    const end = Temporal.Instant.from("2026-10-15T10:00:00Z");
    expect(isWithinDatePeriodBounds(bounds, start)).toBe(true);
    expect(isWithinDatePeriodBounds(bounds, end)).toBe(true);
    expect(isWithinDatePeriodBounds(bounds, start.subtract(millisecond))).toBe(
      false
    );
    expect(isWithinDatePeriodBounds(bounds, end.add(millisecond))).toBe(false);
  });

  test("counts a trigger window from the evaluation time without a trigger", () => {
    expect(
      datePeriodBounds(
        { _tag: "TriggerWindow", side: "before", count: 1, unit: "day" },
        audienceEvaluationAt(now)
      )
    ).toEqual(
      datePeriodBounds(
        { _tag: "Last", count: 1, unit: "day" },
        audienceEvaluationAt(now)
      )
    );
  });
});

describe("datePeriodBoundsEndingBy", () => {
  const start = now.subtract({ hours: 24 });

  test("keeps bounds that end by the instant", () => {
    const bounds = { startsAtOrAfter: start, startsBefore: now };
    expect(datePeriodBoundsEndingBy(bounds, now)).toBe(bounds);
    expect(datePeriodBoundsEndingBy({ startsAtOrBefore: start }, now)).toEqual({
      startsAtOrBefore: start,
    });
  });

  test("ends later or open bounds at the instant, inclusive", () => {
    expect(datePeriodBoundsEndingBy({}, now)).toEqual({
      startsAtOrBefore: now,
    });
    expect(
      datePeriodBoundsEndingBy(
        { startsAtOrAfter: start, startsBefore: now.add(millisecond) },
        now
      )
    ).toEqual({ startsAtOrAfter: start, startsAtOrBefore: now });
  });
});
