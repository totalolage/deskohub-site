import { describe, expect, test } from "bun:test";
import { Option } from "effect";
import {
  addDays,
  addMonths,
  addMonthsToMonth,
  daysBetween,
  hoursBetweenMidnights,
  monthWeeks,
  pragueDateTimeAt,
  pragueInstant,
  pragueMidnight,
  pragueToday,
} from "./prague-date";

describe("pragueToday", () => {
  test("is the next Prague day once Prague passes midnight in winter", () => {
    expect(pragueToday(new Date("2026-01-05T22:59:00Z"))).toBe("2026-01-05");
    expect(pragueToday(new Date("2026-01-05T23:00:00Z"))).toBe("2026-01-06");
  });

  test("is the next Prague day once Prague passes midnight in summer", () => {
    expect(pragueToday(new Date("2026-07-05T21:59:00Z"))).toBe("2026-07-05");
    expect(pragueToday(new Date("2026-07-05T22:00:00Z"))).toBe("2026-07-06");
  });
});

describe("pragueDateTimeAt", () => {
  test("reads midnight as hour 0", () => {
    expect(pragueDateTimeAt(new Date("2026-01-05T23:00:00Z"))).toEqual({
      date: "2026-01-06",
      hour: 0,
      minute: 0,
    });
  });

  test("follows the spring and autumn offset changes", () => {
    // 29 March 2026: 02:00 CET jumps to 03:00 CEST at 01:00 UTC.
    expect(pragueDateTimeAt(new Date("2026-03-29T00:59:00Z")).hour).toBe(1);
    expect(pragueDateTimeAt(new Date("2026-03-29T01:00:00Z")).hour).toBe(3);
    // 25 October 2026: 03:00 CEST falls back to 02:00 CET at 01:00 UTC.
    expect(pragueDateTimeAt(new Date("2026-10-25T00:30:00Z")).hour).toBe(2);
    expect(pragueDateTimeAt(new Date("2026-10-25T01:30:00Z")).hour).toBe(2);
  });
});

describe("calendar arithmetic", () => {
  test("adds days across month, year and daylight-saving boundaries", () => {
    expect(addDays("2026-01-31", 1)).toBe("2026-02-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-28", 2)).toBe("2026-03-30");
    expect(addDays("2026-10-24", 2)).toBe("2026-10-26");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  test("adds months within the target month", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2028-01-31", 1)).toBe("2028-02-29");
    expect(addMonths("2026-08-31", 6)).toBe("2027-02-28");
    expect(addMonths("2026-11-07", 6)).toBe("2027-05-07");
    expect(addMonths("2026-03-15", -3)).toBe("2025-12-15");
  });

  test("counts calendar days regardless of daylight saving", () => {
    expect(daysBetween("2026-03-28", "2026-03-30")).toBe(2);
    expect(daysBetween("2026-10-24", "2026-10-26")).toBe(2);
    expect(daysBetween("2026-11-07", "2026-11-01")).toBe(-6);
  });
});

describe("pragueInstant", () => {
  test("reads the wall clock on the offset in force at that time", () => {
    const at = (date: string, hour: number, minute = 0) =>
      pragueInstant({ date, hour, minute }).toISOString();
    expect(at("2026-11-20", 9, 30)).toBe("2026-11-20T08:30:00.000Z");
    expect(at("2026-07-06", 9)).toBe("2026-07-06T07:00:00.000Z");
    expect(at("2026-03-29", 1)).toBe("2026-03-29T00:00:00.000Z");
    expect(at("2026-03-29", 3)).toBe("2026-03-29T01:00:00.000Z");
    expect(at("2026-10-25", 1)).toBe("2026-10-24T23:00:00.000Z");
    expect(at("2026-10-25", 4)).toBe("2026-10-25T03:00:00.000Z");
  });

  test("round-trips through the Prague wall clock", () => {
    const dateTime = { date: "2026-12-31", hour: 23, minute: 45 };
    expect(pragueDateTimeAt(pragueInstant(dateTime))).toEqual(dateTime);
  });
});

describe("Prague midnights", () => {
  test("begin at 23:00 UTC in winter and 22:00 UTC in summer", () => {
    expect(pragueMidnight("2026-01-06").toISOString()).toBe(
      "2026-01-05T23:00:00.000Z"
    );
    expect(pragueMidnight("2026-07-06").toISOString()).toBe(
      "2026-07-05T22:00:00.000Z"
    );
  });

  test("begin on the old offset on the days the offset changes", () => {
    expect(pragueMidnight("2026-03-29").toISOString()).toBe(
      "2026-03-28T23:00:00.000Z"
    );
    expect(pragueMidnight("2026-10-25").toISOString()).toBe(
      "2026-10-24T22:00:00.000Z"
    );
  });

  test("are 23 hours apart in spring and 25 hours apart in autumn", () => {
    expect(hoursBetweenMidnights("2026-03-29", "2026-03-30")).toBe(23);
    expect(hoursBetweenMidnights("2026-10-25", "2026-10-26")).toBe(25);
    expect(hoursBetweenMidnights("2026-11-07", "2026-12-05")).toBe(672);
    expect(hoursBetweenMidnights("2026-10-01", "2026-10-29")).toBe(673);
  });
});

describe("monthWeeks", () => {
  const days = (week: ReadonlyArray<Option.Option<string>>) =>
    week.map((cell) => Option.getOrElse(cell, () => ""));

  test("lays out a month in Monday-first weeks with empty padding", () => {
    // November 2026 starts on a Sunday and ends on a Monday.
    const weeks = monthWeeks({ year: 2026, month: 11 });

    expect(weeks).toHaveLength(6);
    expect(days(weeks[0] ?? [])).toEqual([
      "",
      "",
      "",
      "",
      "",
      "",
      "2026-11-01",
    ]);
    expect(days(weeks[5] ?? [])).toEqual([
      "2026-11-30",
      "",
      "",
      "",
      "",
      "",
      "",
    ]);
    expect(weeks.flat().filter(Option.isSome)).toHaveLength(30);
  });

  test("fits a Monday-first February of 28 days into four weeks", () => {
    const weeks = monthWeeks({ year: 2027, month: 2 });

    expect(weeks).toHaveLength(4);
    expect(days(weeks[0] ?? [])[0]).toBe("2027-02-01");
    expect(days(weeks[3] ?? [])[6]).toBe("2027-02-28");
  });

  test("moves between months across a year", () => {
    expect(addMonthsToMonth({ year: 2026, month: 12 }, 1)).toEqual({
      year: 2027,
      month: 1,
    });
    expect(addMonthsToMonth({ year: 2026, month: 1 }, -1)).toEqual({
      year: 2025,
      month: 12,
    });
  });
});
