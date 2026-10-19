import { describe, expect, test } from "bun:test";
import type { CalendarExpressionType as CalendarExpression } from "@deskohub/workspace-admin-api";
import { Effect } from "effect";
import {
  CalendarExpressionNeverOccurs,
  calendarFrequency,
  holds,
  nextStart,
  validateCalendarExpression,
} from "./calendar-expression";

const timeZone = "Europe/Prague";

/** A Prague wall time ("2026-12-01T09:00") as an instant. */
const prague = (dateTime: string) =>
  Temporal.PlainDateTime.from(dateTime).toZonedDateTime(timeZone).toInstant();

/** Prague wall time with its offset, so DST shows. */
const wallTime = (instant: Temporal.Instant) =>
  instant
    .toZonedDateTimeISO(timeZone)
    .toString({ smallestUnit: "minute", timeZoneName: "never" });

/** The next `count` period starts after `from`, each after the previous. */
const starts = (
  expression: CalendarExpression,
  from: Temporal.Instant,
  count: number
): string[] => {
  const result: string[] = [];
  let cursor = from;
  for (let index = 0; index < count; index++) {
    cursor = Effect.runSync(nextStart(expression, cursor));
    result.push(wallTime(cursor));
  }
  return result;
};

const probeStart = prague("2026-11-15T00:00");

describe("nextStart", () => {
  test("fires a month period once, on its first day", () => {
    expect(starts({ months: [12] }, probeStart, 3)).toEqual([
      "2026-12-01T00:00+01:00",
      "2027-12-01T00:00+01:00",
      "2028-12-01T00:00+01:00",
    ]);
  });

  test("fires each listed month on its first day", () => {
    expect(starts({ months: [1, 7] }, probeStart, 3)).toEqual([
      "2027-01-01T00:00+01:00",
      "2027-07-01T00:00+02:00",
      "2028-01-01T00:00+01:00",
    ]);
  });

  test("fires an ISO week period on its Monday, even in the previous calendar year", () => {
    expect(starts({ weeksOfYear: [1] }, probeStart, 4)).toEqual([
      "2027-01-04T00:00+01:00",
      "2028-01-03T00:00+01:00",
      "2029-01-01T00:00+01:00",
      "2029-12-31T00:00+01:00",
    ]);
  });

  test("fires the January part of ISO week 1 on its first January day", () => {
    expect(starts({ weeksOfYear: [1], months: [1] }, probeStart, 4)).toEqual([
      "2027-01-04T00:00+01:00",
      "2028-01-03T00:00+01:00",
      "2029-01-01T00:00+01:00",
      "2030-01-01T00:00+01:00",
    ]);
    expect(
      starts({ weeksOfYear: [1], months: [1] }, prague("2029-06-01T00:00"), 1)
    ).toEqual(["2030-01-01T00:00+01:00"]);
  });

  test("fires once per listed ISO week, including week 53", () => {
    expect(starts({ weeksOfYear: [52, 53] }, probeStart, 3)).toEqual([
      "2026-12-21T00:00+01:00",
      "2026-12-28T00:00+01:00",
      "2027-12-27T00:00+01:00",
    ]);
    expect(starts({ weeksOfYear: [53] }, probeStart, 2)).toEqual([
      "2026-12-28T00:00+01:00",
      "2032-12-27T00:00+01:00",
    ]);
  });

  test("fires every December day at an hour-grain time", () => {
    const december = starts({ months: [12], hours: [9] }, probeStart, 32);
    expect(december.slice(0, 3)).toEqual([
      "2026-12-01T09:00+01:00",
      "2026-12-02T09:00+01:00",
      "2026-12-03T09:00+01:00",
    ]);
    expect(december.slice(30)).toEqual([
      "2026-12-31T09:00+01:00",
      "2027-12-01T09:00+01:00",
    ]);
  });

  test("fires weekly", () => {
    expect(
      starts({ weekdays: ["monday"], hours: [10] }, probeStart, 3)
    ).toEqual([
      "2026-11-16T10:00+01:00",
      "2026-11-23T10:00+01:00",
      "2026-11-30T10:00+01:00",
    ]);
  });

  test("fires monthly", () => {
    expect(starts({ daysOfMonth: [1] }, probeStart, 3)).toEqual([
      "2026-12-01T00:00+01:00",
      "2027-01-01T00:00+01:00",
      "2027-02-01T00:00+01:00",
    ]);
  });

  test("fires on the last day of each month", () => {
    expect(
      starts({ daysOfMonth: ["last"], hours: [17] }, probeStart, 4)
    ).toEqual([
      "2026-11-30T17:00+01:00",
      "2026-12-31T17:00+01:00",
      "2027-01-31T17:00+01:00",
      "2027-02-28T17:00+01:00",
    ]);
  });

  test("fires on the 2nd Tuesday", () => {
    expect(
      starts(
        {
          weekdayOccurrences: [{ occurrence: 2, weekday: "tuesday" }],
          hours: [18],
        },
        probeStart,
        3
      )
    ).toEqual([
      "2026-12-08T18:00+01:00",
      "2027-01-12T18:00+01:00",
      "2027-02-09T18:00+01:00",
    ]);
  });

  test("fires on the last Friday", () => {
    expect(
      starts(
        { weekdayOccurrences: [{ occurrence: "last", weekday: "friday" }] },
        probeStart,
        4
      )
    ).toEqual([
      "2026-11-27T00:00+01:00",
      "2026-12-25T00:00+01:00",
      "2027-01-29T00:00+01:00",
      "2027-02-26T00:00+01:00",
    ]);
  });

  test("fires on Friday the 13th only", () => {
    expect(
      starts({ weekdays: ["friday"], daysOfMonth: [13] }, probeStart, 2)
    ).toEqual(["2027-08-13T00:00+02:00", "2028-10-13T00:00+02:00"]);
  });

  test("fires on a Monday of ISO week 1 that falls in the previous calendar year", () => {
    expect(
      starts(
        { weeksOfYear: [1], weekdays: ["monday"], hours: [8] },
        prague("2029-06-01T00:00"),
        1
      )
    ).toEqual(["2029-12-31T08:00+01:00"]);
  });

  test("fires every hour at each listed minute", () => {
    expect(starts({ minutes: [0, 30] }, prague("2026-11-15T09:10"), 3)).toEqual(
      [
        "2026-11-15T09:30+01:00",
        "2026-11-15T10:00+01:00",
        "2026-11-15T10:30+01:00",
      ]
    );
  });

  test("moves a time in the spring DST gap forward", () => {
    expect(
      starts({ hours: [2], minutes: [30] }, prague("2026-03-28T12:00"), 2)
    ).toEqual(["2026-03-29T03:30+02:00", "2026-03-30T02:30+02:00"]);
  });

  test("fires a repeated autumn time once", () => {
    expect(
      starts({ hours: [2], minutes: [30] }, prague("2026-10-24T12:00"), 2)
    ).toEqual(["2026-10-25T02:30+02:00", "2026-10-26T02:30+01:00"]);
    expect(
      starts(
        { weekdays: ["monday"], hours: [10] },
        prague("2026-10-24T12:00"),
        1
      )
    ).toEqual(["2026-10-26T10:00+01:00"]);
    expect(starts({ daysOfMonth: [1] }, prague("2026-10-24T12:00"), 1)).toEqual(
      ["2026-11-01T00:00+01:00"]
    );
  });

  test("starts strictly after the given instant", () => {
    expect(starts({ months: [12] }, prague("2026-12-01T00:00"), 1)).toEqual([
      "2027-12-01T00:00+01:00",
    ]);
  });

  test("finds Feb 29 four years ahead", () => {
    expect(
      starts({ daysOfMonth: [29], months: [2] }, prague("2028-03-01T00:00"), 1)
    ).toEqual(["2032-02-29T00:00+01:00"]);
  });

  test.each<[string, CalendarExpression]>([
    ["Feb 31", { daysOfMonth: [31], months: [2] }],
    [
      "a Monday that is a 2nd Tuesday",
      {
        weekdays: ["monday"],
        weekdayOccurrences: [{ occurrence: 2, weekday: "tuesday" }],
      },
    ],
  ])("fails for %s", (_, expression) => {
    const error = Effect.runSync(
      Effect.flip(nextStart(expression, probeStart))
    );
    expect(error).toBeInstanceOf(CalendarExpressionNeverOccurs);
    expect(error.expression).toEqual(expression);
  });
});

describe("holds", () => {
  test("holds through a whole month period", () => {
    const december = { months: [12] } satisfies CalendarExpression;
    expect(holds(december, prague("2026-12-15T12:00"))).toBe(true);
    expect(holds(december, prague("2026-12-01T00:00"))).toBe(true);
    expect(holds(december, prague("2026-12-31T23:59:59.999"))).toBe(true);
    expect(holds(december, prague("2026-11-30T23:59:59.999"))).toBe(false);
    expect(holds(december, prague("2026-11-30T12:00"))).toBe(false);
    expect(holds(december, prague("2027-01-01T00:00"))).toBe(false);
  });

  test("holds through a whole hour", () => {
    const tenOClock = { hours: [10] } satisfies CalendarExpression;
    expect(holds(tenOClock, prague("2026-11-16T10:00"))).toBe(true);
    expect(holds(tenOClock, prague("2026-11-16T10:59:59.999"))).toBe(true);
    expect(holds(tenOClock, prague("2026-11-16T09:59:59.999"))).toBe(false);
    expect(holds(tenOClock, prague("2026-11-16T11:00"))).toBe(false);
  });

  test("holds through a whole minute on matching days only", () => {
    const expression = {
      weekdays: ["monday"],
      hours: [9],
      minutes: [15],
    } satisfies CalendarExpression;
    expect(holds(expression, prague("2026-11-16T09:15"))).toBe(true);
    expect(holds(expression, prague("2026-11-16T09:15:59.999"))).toBe(true);
    expect(holds(expression, prague("2026-11-16T09:16"))).toBe(false);
    expect(holds(expression, prague("2026-11-17T09:15"))).toBe(false);
  });

  test("never holds a skipped hour and holds both repeated hours", () => {
    const twoOClock = { hours: [2] } satisfies CalendarExpression;
    expect(
      holds(twoOClock, Temporal.Instant.from("2026-03-29T00:59:59Z"))
    ).toBe(false);
    expect(
      holds(twoOClock, Temporal.Instant.from("2026-03-29T01:00:00Z"))
    ).toBe(false);
    expect(
      holds(twoOClock, Temporal.Instant.from("2026-10-25T00:30:00Z"))
    ).toBe(true);
    expect(
      holds(twoOClock, Temporal.Instant.from("2026-10-25T01:30:00Z"))
    ).toBe(true);
  });
});

describe("calendarFrequency", () => {
  test.each<[CalendarExpression, number, boolean]>([
    [{ minutes: [0, 30] }, 2, true],
    [{ minutes: [15] }, 1, false],
    [{ hours: [9, 17] }, 1, false],
    [
      {
        minutes: Array.from({ length: 60 }, (_, minute) => minute) as [
          number,
          ...number[],
        ],
      },
      60,
      true,
    ],
  ])("%j fires at most %d times an hour", (expression, max, moreThanHourly) => {
    expect(calendarFrequency(expression)).toEqual({
      maxFiresPerHour: max,
      firesMoreThanHourly: moreThanHourly,
    });
  });
});

describe("validateCalendarExpression", () => {
  test("returns an occurring expression in canonical order", () => {
    expect(
      Effect.runSync(
        validateCalendarExpression({
          months: [7, 1],
          weekdays: ["friday", "monday"],
        })
      )
    ).toEqual({ weekdays: ["monday", "friday"], months: [1, 7] });
  });

  test("rejects an expression with no start within eight years", () => {
    const error = Effect.runSync(
      Effect.flip(
        validateCalendarExpression({ daysOfMonth: [31], months: [2] })
      )
    );
    expect(error._tag).toBe("CalendarExpressionNeverOccurs");
  });
});
