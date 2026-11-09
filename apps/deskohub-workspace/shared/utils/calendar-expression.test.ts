import { describe, expect, test } from "bun:test";
import type { CalendarExpressionType as CalendarExpression } from "@deskohub/workspace-admin-api";
import { Effect, Option } from "effect";
import {
  CalendarExpressionNeverOccurs,
  calendarFrequency,
  holds,
  nextStart,
  nextStartWithinHorizon,
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

  test.each<[string, CalendarExpression, string]>([
    ["an hourly", { minutes: [30] }, "2026-10-25T03:30+01:00"],
    ["a half-hourly", { minutes: [0, 30] }, "2026-10-25T03:00+01:00"],
    ["a daily", { hours: [2], minutes: [30] }, "2026-10-26T02:30+01:00"],
  ])(
    "skips %s time already started in the first repeated autumn hour",
    (_, expression, expected) => {
      // 02:10 CET, in the second occurrence of 02:00–02:59.
      const secondTwoTen = Temporal.Instant.from("2026-10-25T01:10:00Z");
      expect(starts(expression, secondTwoTen, 1)).toEqual([expected]);
    }
  );

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

describe("nextStartWithinHorizon", () => {
  test("returns the start nextStart succeeds with", () => {
    const expression: CalendarExpression = { weeksOfYear: [1] };
    expect(nextStartWithinHorizon(expression, probeStart)).toEqual(
      Option.some(Effect.runSync(nextStart(expression, probeStart)))
    );
  });

  test("is none where nextStart fails", () => {
    expect(
      nextStartWithinHorizon({ daysOfMonth: [31], months: [2] }, probeStart)
    ).toEqual(Option.none());
  });
});

describe("nextStart around 2026 DST transitions", () => {
  const minute = { minutes: 1 } as const;
  const transitionDays = ["2026-03-29", "2026-10-25"].map((day) =>
    Temporal.PlainDate.from(day)
  );

  /** Whether `instant` is the second occurrence of a repeated wall time. */
  const isRepeat = (instant: Temporal.Instant) => {
    const zoned = instant.toZonedDateTimeISO(timeZone);
    return !zoned
      .toPlainDateTime()
      .toZonedDateTime(timeZone, { disambiguation: "earlier" })
      .toInstant()
      .equals(instant);
  };

  /*
   * A brute-force reference for period starts that shares no code with the
   * module. It steps the Prague wall times of each day minute by minute and
   * applies the DST policy explicitly: a wall time the spring gap skips fires
   * shifted forward by the gap length, and a wall time the autumn overlap
   * repeats fires at its first occurrence only.
   */
  const isoWeekdays = [
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
    "sunday",
  ];

  const referenceDayMatches = (
    expression: CalendarExpression,
    date: Temporal.PlainDate
  ) => {
    const weekday = isoWeekdays[date.dayOfWeek - 1];
    const { weekdays, daysOfMonth, weekdayOccurrences, weeksOfYear, months } =
      expression;
    return (
      (weekdays === undefined ||
        weekdays.some((listed) => listed === weekday)) &&
      (daysOfMonth === undefined ||
        daysOfMonth.some((day) =>
          day === "last"
            ? date.add({ days: 1 }).month !== date.month
            : day === date.day
        )) &&
      (weekdayOccurrences === undefined ||
        weekdayOccurrences.some(
          (listed) =>
            listed.weekday === weekday &&
            (listed.occurrence === "last"
              ? date.add({ days: 7 }).month !== date.month
              : date.subtract({ days: 7 * (listed.occurrence - 1) }).month ===
                  date.month &&
                date.subtract({ days: 7 * listed.occurrence }).month !==
                  date.month)
        )) &&
      (weeksOfYear === undefined ||
        weeksOfYear.some((week) => week === date.weekOfYear)) &&
      (months === undefined || months.includes(date.month))
    );
  };

  /** At week or month grain only the first matching day of its ISO week or month starts a period. */
  const referenceFireDay = (
    expression: CalendarExpression,
    date: Temporal.PlainDate
  ) => {
    if (!referenceDayMatches(expression, date)) {
      return false;
    }
    const { minutes, hours, weekdays, daysOfMonth, weekdayOccurrences } =
      expression;
    if (minutes || hours || weekdays || daysOfMonth || weekdayOccurrences) {
      return true;
    }
    const groupStart = expression.weeksOfYear
      ? date.subtract({ days: date.dayOfWeek - 1 })
      : date.with({ day: 1 });
    for (
      let day = groupStart;
      Temporal.PlainDate.compare(day, date) < 0;
      day = day.add({ days: 1 })
    ) {
      if (referenceDayMatches(expression, day)) {
        return false;
      }
    }
    return true;
  };

  const referenceTimeMatches = (
    expression: CalendarExpression,
    wall: Temporal.PlainDateTime
  ) =>
    (expression.minutes ?? [0]).includes(wall.minute) &&
    ((expression.hours ?? (expression.minutes ? undefined : [0]))?.includes(
      wall.hour
    ) ??
      true);

  /** When a Prague wall time that starts a period fires. */
  const referenceFireInstant = (wall: Temporal.PlainDateTime) => {
    const first = wall.toZonedDateTime(timeZone, {
      disambiguation: "earlier",
    });
    if (first.toPlainDateTime().equals(wall)) {
      return first.toInstant();
    }
    // Skipped by the spring gap: reading the wall time at the offset in force
    // before the gap moves it forward by the gap length.
    const offsetBefore = wall
      .subtract({ days: 1 })
      .toZonedDateTime(timeZone).offset;
    return Temporal.Instant.from(`${wall.toString()}${offsetBefore}`);
  };

  /** Every period start whose wall time falls on the Prague days `first` through `last`, in time order. */
  const referenceStarts = (
    expression: CalendarExpression,
    first: Temporal.PlainDate,
    last: Temporal.PlainDate
  ) => {
    const result: Temporal.Instant[] = [];
    for (
      let date = first;
      Temporal.PlainDate.compare(date, last) <= 0;
      date = date.add({ days: 1 })
    ) {
      if (!referenceFireDay(expression, date)) {
        continue;
      }
      for (let index = 0; index < 24 * 60; index++) {
        const wall = date.toPlainDateTime({
          hour: Math.floor(index / 60),
          minute: index % 60,
        });
        if (referenceTimeMatches(expression, wall)) {
          result.push(referenceFireInstant(wall));
        }
      }
    }
    return result.sort(Temporal.Instant.compare);
  };

  const expressions: [string, CalendarExpression][] = [
    ["hourly", { minutes: [30] }],
    ["half-hourly", { minutes: [0, 30] }],
    [
      "quarter past and to, early hours",
      { hours: [1, 2, 3], minutes: [15, 45] },
    ],
    ["daily in the skipped hour", { hours: [2], minutes: [30] }],
    ["twice daily in the skipped hour", { hours: [2], minutes: [0, 45] }],
    [
      "daily in the skipped and the next hour",
      { hours: [2, 3], minutes: [30] },
    ],
    ["daily at hour grain", { hours: [2] }],
    [
      "on the last Sunday",
      {
        weekdayOccurrences: [{ occurrence: "last", weekday: "sunday" }],
        hours: [2],
        minutes: [30],
      },
    ],
    [
      "on weekend days and Mondays",
      { weekdays: ["saturday", "sunday", "monday"] },
    ],
    ["weekly", { weeksOfYear: [13, 14, 43, 44] }],
    ["monthly", { months: [3, 4, 10, 11] }],
  ];

  test.each(expressions)(
    "%s starts equal the reference for inputs every 30 s around each transition",
    (_, expression) => {
      const failures: string[] = [];
      for (const day of transitionDays) {
        const expected = referenceStarts(
          expression,
          day.subtract({ days: 1 }),
          day.add({ days: 40 })
        );
        const from = day
          .subtract({ days: 1 })
          .toZonedDateTime({ timeZone, plainTime: "20:00" })
          .toInstant();
        const to = from.add({ hours: 16 });
        for (
          let after = from;
          Temporal.Instant.compare(after, to) < 0;
          after = after.add({ seconds: 30 })
        ) {
          const next = Effect.runSync(nextStart(expression, after));
          const reference = expected.find(
            (start) => Temporal.Instant.compare(start, after) > 0
          );
          if (reference === undefined || !next.equals(reference)) {
            failures.push(`after ${after}: ${next}, reference ${reference}`);
          }
        }
      }
      expect(failures).toEqual([]);
    }
  );

  // `holds` reads the wall time an instant shows, so it differs from the
  // reference in two places only, both by design (§3.5): a start moved out of
  // the spring gap shows a wall time the expression doesn't name, so `holds`
  // is false there; and both occurrences of a repeated autumn wall time hold,
  // though only the first starts a period.
  test.each(expressions)(
    "%s: holds agrees with the reference outside the spring gap",
    (_, expression) => {
      const failures: string[] = [];
      for (const day of transitionDays) {
        const expected = new Set(
          referenceStarts(
            expression,
            day.subtract({ days: 1 }),
            day.add({ days: 1 })
          ).map(String)
        );
        const from = day
          .subtract({ days: 1 })
          .toZonedDateTime({ timeZone })
          .toInstant();
        const to = day
          .add({ days: 2 })
          .toZonedDateTime({ timeZone })
          .toInstant();
        for (
          let at = from;
          Temporal.Instant.compare(at, to) < 0;
          at = at.add(minute)
        ) {
          const wall = at.toZonedDateTimeISO(timeZone).toPlainDateTime();
          const held = holds(expression, at);
          if (
            !held &&
            referenceFireDay(expression, wall.toPlainDate()) &&
            referenceTimeMatches(expression, wall)
          ) {
            failures.push(`${at} names a start but doesn't hold`);
          }
          if (
            held &&
            !holds(expression, at.subtract(minute)) &&
            !isRepeat(at) &&
            !expected.has(at.toString())
          ) {
            failures.push(`${at} starts holding without a reference start`);
          }
        }
      }
      expect(failures).toEqual([]);
    }
  );

  test("returns the shifted spring start for every input before it", () => {
    const expression = {
      hours: [2],
      minutes: [30],
    } satisfies CalendarExpression;
    const shifted = Temporal.Instant.from("2026-03-29T01:30:00Z");
    const failures: string[] = [];
    for (
      let after = prague("2026-03-29T03:00");
      Temporal.Instant.compare(after, shifted) < 0;
      after = after.add({ seconds: 1 })
    ) {
      const next = Effect.runSync(nextStart(expression, after));
      if (!next.equals(shifted)) {
        failures.push(
          `after ${wallTime(after)}:${after.toString().slice(17, 19)}: ${next}`
        );
      }
    }
    expect(failures).toEqual([]);
    expect(
      Effect.runSync(
        nextStart(expression, Temporal.Instant.from("2026-03-29T01:29:59.999Z"))
      )
    ).toEqual(shifted);
    expect(wallTime(Effect.runSync(nextStart(expression, shifted)))).toBe(
      "2026-03-30T02:30+02:00"
    );
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
    [{ minutes: [0, 15, 30, 45] }, 4, true],
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
