import { describe, expect, test } from "bun:test";
import "@/shared/polyfills/temporal";
import {
  formatInstantDate,
  formatPlainDate,
  formatPlainDateRange,
} from "./date-time-format";

describe("date-time formatting", () => {
  test("formats an instant in the requested time zone", () => {
    const instant = Temporal.Instant.from("2099-02-03T23:30:00Z");

    expect(
      formatInstantDate({
        instant,
        locale: "en-US",
        timeZone: "Europe/Prague",
      })
    ).toBe("Feb 4, 2099");
    expect(
      formatInstantDate({ instant, locale: "en-US", timeZone: "UTC" })
    ).toBe("Feb 3, 2099");
  });

  test("formats plain dates without applying an environmental time zone", () => {
    expect(
      formatPlainDate({
        date: Temporal.PlainDate.from("2099-01-01"),
        locale: "cs-CZ",
      })
    ).toBe("1. 1. 2099");
    expect(
      formatPlainDateRange({
        start: Temporal.PlainDate.from("2099-06-20"),
        end: Temporal.PlainDate.from("2099-06-21"),
        locale: "en-US",
      })
    ).toBe("Jun 20 – 21, 2099");
  });
});
