import { describe, expect, test } from "bun:test";
import { Option } from "effect";
import "@/shared/polyfills/temporal";
import {
  formatInstantDate,
  formatInstantDateTime,
  formatNumericPlainDate,
  formatNumericPlainDatePattern,
  formatPlainDate,
  formatPlainDateRange,
  formatWeekday,
  parseNumericPlainDate,
  withPlainSpaces,
} from "./date-time-format";

describe("date-time formatting", () => {
  test("writes times and ranges with the plain spaces browsers render", () => {
    expect(withPlainSpaces("11:00\u202FAM\u2009–\u200912:00\u202FPM")).toBe(
      "11:00 AM – 12:00 PM"
    );
  });

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

  test("formats a plain date in the locale's numeric form and pattern", () => {
    const date = Temporal.PlainDate.from("2099-11-05");
    const tokens = { day: "DD", month: "MM", year: "YYYY" };

    expect(formatNumericPlainDate({ date, locale: "en-US" })).toBe("11/5/2099");
    expect(formatNumericPlainDate({ date, locale: "cs-CZ" })).toBe(
      "5. 11. 2099"
    );
    expect(formatNumericPlainDatePattern({ locale: "en-US", tokens })).toBe(
      "MM/DD/YYYY"
    );
    expect(
      formatNumericPlainDatePattern({
        locale: "cs-CZ",
        tokens: { ...tokens, year: "RRRR" },
      })
    ).toBe("DD. MM. RRRR");
  });

  test("reads a typed ISO or locale numeric date", () => {
    const read = (text: string, locale: string) =>
      Option.getOrUndefined(
        parseNumericPlainDate({ locale, text })
      )?.toString();

    expect(read("2099-11-05", "en-US")).toBe("2099-11-05");
    expect(read(" 2099-11-05 ", "cs-CZ")).toBe("2099-11-05");
    expect(read("11/5/2099", "en-US")).toBe("2099-11-05");
    expect(read("11/05/2099", "en-US")).toBe("2099-11-05");
    expect(read("5. 11. 2099", "cs-CZ")).toBe("2099-11-05");
    expect(read("5.11.2099", "cs-CZ")).toBe("2099-11-05");
    expect(read("05.11.2099.", "cs-CZ")).toBe("2099-11-05");
    // The same numbers read in each locale's own order.
    expect(read("3/4/2099", "en-US")).toBe("2099-03-04");
    expect(read("3/4/2099", "cs-CZ")).toBe("2099-04-03");
  });

  test("rejects text that is no complete calendar date", () => {
    const read = (text: string, locale = "en-US") =>
      Option.isSome(parseNumericPlainDate({ locale, text }));

    expect(read("")).toBe(false);
    expect(read("tomorrow")).toBe(false);
    expect(read("11/5")).toBe(false);
    expect(read("11/5/99")).toBe(false);
    expect(read("13/1/2099")).toBe(false);
    expect(read("2/30/2099")).toBe(false);
    expect(read("2099-02-29")).toBe(false);
    expect(read("31. 4. 2099", "cs-CZ")).toBe(false);
    expect(read("11/5/2099/1")).toBe(false);
  });
});
