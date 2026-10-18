import { describe, expect, test } from "bun:test";
import "@/shared/polyfills/temporal";
import {
  formatInstantDate,
  formatInstantDateTime,
  formatPlainDate,
  formatPlainDateRange,
  formatWeekday,
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

  test("formats an instant's date and time in the requested locale", () => {
    const instant = Temporal.Instant.from("2099-02-03T23:30:00Z");

    expect(
      formatInstantDateTime({
        instant,
        locale: "cs-CZ",
        timeZone: "Europe/Prague",
      }).replace(/\s/gu, " ")
    ).toBe("4. 2. 2099 0:30");
    expect(
      formatInstantDateTime({
        instant,
        locale: "en-US",
        timeZone: "UTC",
      }).replace(/\s/gu, " ")
    ).toBe("Feb 3, 2099, 11:30 PM");
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

  test("names ISO weekdays from Monday to Sunday in the locale", () => {
    expect(formatWeekday({ isoDay: 1, locale: "en-US" })).toBe("Mon");
    expect(formatWeekday({ isoDay: 7, locale: "en-US" })).toBe("Sun");
    expect(formatWeekday({ isoDay: 1, locale: "cs-CZ" })).toBe("po");
    expect(formatWeekday({ isoDay: 3, locale: "cs-CZ" })).toBe("st");
  });
});
