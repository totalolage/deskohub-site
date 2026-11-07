import { describe, expect, test } from "bun:test";
import { formatPragueDate, formatPragueTime } from "./prague-date-format";

const numericDate = {
  year: "numeric",
  month: "numeric",
  day: "numeric",
} as const;

describe("formatPragueDate", () => {
  test("keeps the calendar day whatever the time zone", () => {
    expect(formatPragueDate("2026-12-31", "cs-CZ", numericDate)).toBe(
      "31. 12. 2026"
    );
    expect(formatPragueDate("2026-01-01", "en-US", numericDate)).toBe(
      "1/1/2026"
    );
  });
});

describe("formatPragueTime", () => {
  test("keeps the wall-clock time whatever the time zone", () => {
    expect(formatPragueTime("23:30", "cs-CZ")).toBe("23:30");
    expect(formatPragueTime("00:15", "cs-CZ")).toBe("0:15");
  });
});
