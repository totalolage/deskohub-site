import { describe, expect, test } from "bun:test";
import { DateTime, Option } from "effect";
import {
  formatInstant,
  formatInstantRange,
  formatWorkspaceDays,
  parseInstant,
} from "./date-time-format";

const instant = (iso: string) => DateTime.makeUnsafe(iso);

describe("parseInstant", () => {
  test("reads an ISO 8601 instant", () => {
    const parsed = parseInstant("2026-01-05T09:30:00.000Z");
    expect(Option.map(parsed, DateTime.toEpochMillis)).toEqual(
      Option.some(Date.UTC(2026, 0, 5, 9, 30))
    );
  });

  test("gives none for text that is not an instant", () => {
    expect(Option.isNone(parseInstant("not a time"))).toBe(true);
    expect(Option.isNone(parseInstant(""))).toBe(true);
  });
});

describe("formatInstant", () => {
  test("shows Prague wall-clock time in winter and in summer", () => {
    for (const locale of ["en-US", "cs-CZ"] as const) {
      expect(
        formatInstant(instant("2026-01-05T09:30:00Z"), locale, "time")
      ).toContain("10:30");
      expect(
        formatInstant(instant("2026-07-01T08:00:00Z"), locale, "time")
      ).toContain("10:00");
    }
  });

  test("dates an instant by its Prague calendar day", () => {
    // 23:30 UTC on 5 January is already 6 January in Prague.
    const lateEvening = instant("2026-01-05T23:30:00Z");
    expect(formatInstant(lateEvening, "en-US", "date")).toContain("6");
    expect(formatInstant(lateEvening, "en-US", "date")).not.toContain("5");
    expect(formatInstant(lateEvening, "cs-CZ", "date-time")).toMatch(
      /\b0?0:30\b/
    );
  });

  test("formats differently per locale", () => {
    const morning = instant("2026-01-05T09:30:00Z");
    expect(formatInstant(morning, "en-US", "date-time")).not.toBe(
      formatInstant(morning, "cs-CZ", "date-time")
    );
  });
});

describe("formatInstantRange", () => {
  test("reads Prague days where Intl ignores the requested hour cycle", () => {
    // An engine that ignores `hourCycle` gives midnight as hour 12, as the
    // app's Android build showed; whole days must still read as whole days.
    const RealDateTimeFormat = Intl.DateTimeFormat;
    class IgnoringHourCycle extends RealDateTimeFormat {
      constructor(
        locales?: string | string[],
        options?: Intl.DateTimeFormatOptions
      ) {
        const { hourCycle: _ignored, ...supported } = options ?? {};
        super(locales, supported);
      }
    }
    Intl.DateTimeFormat = IgnoringHourCycle as typeof Intl.DateTimeFormat;
    try {
      // 30 November 00:00 to 1 December 00:00 Prague time.
      const range = formatInstantRange(
        instant("2026-11-29T23:00:00Z"),
        instant("2026-11-30T23:00:00Z"),
        "en-US"
      );
      expect(range).toEqual({
        start: "Monday, November 30, 2026",
        end: Option.none(),
      });
    } finally {
      Intl.DateTimeFormat = RealDateTimeFormat;
    }
  });

  test("shows the end of a range within one Prague day as a time only", () => {
    const start = instant("2026-01-05T09:00:00Z");
    const end = instant("2026-01-05T17:00:00Z");
    for (const locale of ["en-US", "cs-CZ"] as const) {
      expect(formatInstantRange(start, end, locale)).toEqual({
        start: formatInstant(start, locale, "date-time"),
        end: Option.some(formatInstant(end, locale, "time")),
      });
    }
  });

  test("dates both ends of a range across Prague days", () => {
    // 22:00 to 23:30 UTC crosses Prague midnight in winter.
    const start = instant("2026-01-05T22:00:00Z");
    const end = instant("2026-01-05T23:30:00Z");
    expect(formatInstantRange(start, end, "en-US")).toEqual({
      start: formatInstant(start, "en-US", "date-time"),
      end: Option.some(formatInstant(end, "en-US", "date-time")),
    });
  });

  test("reads Prague midnight to midnight as whole days, the end exclusive", () => {
    // 5 January 00:00 to 12 January 00:00 Prague time (UTC+1).
    const range = formatInstantRange(
      instant("2026-01-04T23:00:00Z"),
      instant("2026-01-11T23:00:00Z"),
      "en-US"
    );
    expect(range).toEqual({
      start: "Monday, January 5, 2026",
      end: Option.some("Sunday, January 11, 2026"),
    });
  });

  test("reads one whole Prague day as that day alone", () => {
    const range = formatInstantRange(
      instant("2026-01-04T23:00:00Z"),
      instant("2026-01-05T23:00:00Z"),
      "cs-CZ"
    );
    expect(range).toEqual({
      start: "pondělí 5. ledna 2026",
      end: Option.none(),
    });
  });

  test("keeps the time on a midnight range that doesn't move forward", () => {
    const midnight = instant("2026-01-04T23:00:00Z");
    expect(formatInstantRange(midnight, midnight, "en-US")).toEqual({
      start: formatInstant(midnight, "en-US", "date-time"),
      end: Option.some(formatInstant(midnight, "en-US", "time")),
    });
  });
});

describe("formatWorkspaceDays", () => {
  test("shows the first and last Prague day, the end exclusive", () => {
    // 30 November 00:00 to 17:00 is one day; to 3 December 00:00 is three.
    const start = instant("2026-11-29T23:00:00Z");
    expect(
      formatWorkspaceDays(start, instant("2026-11-30T16:00:00Z"), "en-US")
    ).toEqual({ start: "Monday, November 30, 2026", end: Option.none() });
    expect(
      formatWorkspaceDays(start, instant("2026-12-02T23:00:00Z"), "en-US")
    ).toEqual({
      start: "Monday, November 30, 2026",
      end: Option.some("Wednesday, December 2, 2026"),
    });
  });

  test("shows the start day alone when the end doesn't move forward", () => {
    const start = instant("2026-11-29T23:00:00Z");
    expect(formatWorkspaceDays(start, start, "en-US")).toEqual({
      start: "Monday, November 30, 2026",
      end: Option.none(),
    });
  });
});
