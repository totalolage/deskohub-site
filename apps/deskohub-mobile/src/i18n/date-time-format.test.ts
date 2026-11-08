import { describe, expect, test } from "bun:test";
import { DateTime, Option } from "effect";
import {
  formatInstant,
  formatInstantRange,
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
  test("shows the end of a range within one Prague day as a time only", () => {
    const start = instant("2026-01-05T09:00:00Z");
    const end = instant("2026-01-05T17:00:00Z");
    for (const locale of ["en-US", "cs-CZ"] as const) {
      expect(formatInstantRange(start, end, locale)).toEqual({
        start: formatInstant(start, locale, "date-time"),
        end: formatInstant(end, locale, "time"),
      });
    }
  });

  test("dates both ends of a range across Prague days", () => {
    // 22:00 to 23:30 UTC crosses Prague midnight in winter.
    const start = instant("2026-01-05T22:00:00Z");
    const end = instant("2026-01-05T23:30:00Z");
    expect(formatInstantRange(start, end, "en-US")).toEqual({
      start: formatInstant(start, "en-US", "date-time"),
      end: formatInstant(end, "en-US", "date-time"),
    });
  });

  test("reads Prague midnight to midnight as whole days, the end exclusive", () => {
    // 5 January 00:00 to 12 January 00:00 Prague time (UTC+1).
    const start = instant("2026-01-04T23:00:00Z");
    const end = instant("2026-01-11T23:00:00Z");
    const range = formatInstantRange(start, end, "en-US");
    expect(range.start).toBe(formatInstant(start, "en-US", "date"));
    expect(range.end).toBe(
      formatInstant(instant("2026-01-11T12:00:00Z"), "en-US", "date")
    );
    expect(range.end).not.toContain(":");
  });

  test("keeps the time on a midnight range that doesn't move forward", () => {
    const midnight = instant("2026-01-04T23:00:00Z");
    expect(formatInstantRange(midnight, midnight, "en-US")).toEqual({
      start: formatInstant(midnight, "en-US", "date-time"),
      end: formatInstant(midnight, "en-US", "time"),
    });
  });
});
