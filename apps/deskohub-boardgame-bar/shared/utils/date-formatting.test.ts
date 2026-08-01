import { describe, expect, test } from "bun:test";
import { formatDurationMinutes } from "./date-formatting";

describe("formatDurationMinutes", () => {
  test.each([
    [60, "en-US", "1 hour"],
    [120, "en-US", "2 hours"],
    [60, "cs-CZ", "1 hodina"],
    [120, "cs-CZ", "2 hodiny"],
    [300, "cs-CZ", "5 hodin"],
  ] as const)("formats %i minutes in %s", (minutes, locale, expected) => {
    expect(formatDurationMinutes(minutes, locale)).toBe(expected);
  });
});
