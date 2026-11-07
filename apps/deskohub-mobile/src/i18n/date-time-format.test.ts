import { describe, expect, test } from "bun:test";
import { DateTime, Option } from "effect";
import { formatInstant, parseInstant } from "./date-time-format";

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
