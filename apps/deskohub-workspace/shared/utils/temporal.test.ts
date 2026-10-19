import { describe, expect, test } from "bun:test";
import "@/shared/polyfills/temporal";
import { Option, Schema } from "effect";
import {
  ceilToWholeHour,
  floorToWholeHour,
  getPlainDatesBetween,
  instantStringSchema,
  isFuturePlainDateTime,
  isPlainDateString,
  localDateTimeSchema,
  localDateTimeToInstant,
  localDateTimeToTemporalInstantString,
  localTimeSchema,
  makeWholeHourInstantStringSchema,
  parseInstant,
  parsePlainDate,
  temporalInstantToLocalDateTimeString,
} from "./temporal";

test("floors a zoned date-time to its local hour", () => {
  const value = Temporal.ZonedDateTime.from(
    "2026-07-10T10:42:37.123456789+02:00[Europe/Prague]"
  );

  expect(floorToWholeHour(value).toString()).toBe(
    "2026-07-10T10:00:00+02:00[Europe/Prague]"
  );
});

test("ceils a zoned date-time to its containing or next local hour", () => {
  expect(
    ceilToWholeHour(
      Temporal.ZonedDateTime.from(
        "2026-07-10T10:42:37.123456789+02:00[Europe/Prague]"
      )
    ).toString()
  ).toBe("2026-07-10T11:00:00+02:00[Europe/Prague]");
  expect(
    ceilToWholeHour(
      Temporal.ZonedDateTime.from("2026-07-10T10:00:00+02:00[Europe/Prague]")
    ).toString()
  ).toBe("2026-07-10T10:00:00+02:00[Europe/Prague]");
});

describe("instantStringSchema", () => {
  const isInstantString = Schema.is(instantStringSchema);

  test("accepts ISO timestamps with an offset", () => {
    expect(isInstantString("2026-07-10T08:00:00Z")).toBe(true);
    expect(isInstantString("2026-07-10T10:00:00+02:00")).toBe(true);
  });

  test("rejects local timestamps and invalid strings", () => {
    expect(isInstantString("2026-07-10T10:00:00")).toBe(false);
    expect(isInstantString("not-an-instant")).toBe(false);
  });
});

describe("isFuturePlainDateTime", () => {
  test("compares a local date-time in the supplied time zone", () => {
    const now = Temporal.Instant.from("2026-07-10T10:00:00Z");
    const dateTime = Temporal.PlainDateTime.from("2026-07-10T08:00");

    expect(
      isFuturePlainDateTime({ dateTime, timeZone: "Europe/Prague", now })
    ).toBe(false);
    expect(
      isFuturePlainDateTime({ dateTime, timeZone: "America/New_York", now })
    ).toBe(true);
  });
});

describe("makeWholeHourInstantStringSchema", () => {
  const isWholeHourInPrague = Schema.is(
    makeWholeHourInstantStringSchema("Europe/Prague")
  );

  test("accepts instants that fall on a whole hour in the supplied time zone", () => {
    expect(isWholeHourInPrague("2026-07-10T08:00:00Z")).toBe(true);
  });

  test("rejects partial hours and invalid instants", () => {
    expect(isWholeHourInPrague("2026-07-10T08:00:00.001Z")).toBe(false);
    expect(isWholeHourInPrague("not-an-instant")).toBe(false);
  });

  test("rejects instants when the time zone is unknown", () => {
    expect(
      Schema.is(makeWholeHourInstantStringSchema("Not/A_Zone"))(
        "2026-07-10T08:00:00Z"
      )
    ).toBe(false);
  });
});

describe("localTimeSchema", () => {
  const isLocalTime = Schema.is(localTimeSchema);

  test("accepts canonical hour and minute times", () => {
    expect(isLocalTime("08:30")).toBe(true);
  });

  test("rejects noncanonical and invalid times", () => {
    expect(isLocalTime("08:30:00")).toBe(false);
    expect(isLocalTime("8:30")).toBe(false);
    expect(isLocalTime("25:00")).toBe(false);
    expect(isLocalTime("not-a-time")).toBe(false);
  });
});

describe("localDateTimeSchema", () => {
  const isLocalDateTime = Schema.is(localDateTimeSchema);

  test("accepts canonical local date-times to the minute or second", () => {
    expect(isLocalDateTime("2026-07-10T08:30")).toBe(true);
    expect(isLocalDateTime("2026-07-10T08:30:15")).toBe(true);
  });

  test("rejects noncanonical, offset and invalid date-times", () => {
    expect(isLocalDateTime("2026-07-10T08:30:00")).toBe(false);
    expect(isLocalDateTime("2026-07-10T08:30Z")).toBe(false);
    expect(isLocalDateTime("2026-02-30T08:30")).toBe(false);
    expect(isLocalDateTime("not-a-date-time")).toBe(false);
  });
});

describe("isPlainDateString", () => {
  const isCanonicalPlainDate = Schema.is(
    Schema.String.check(isPlainDateString())
  );

  test("accepts canonical calendar dates", () => {
    expect(isCanonicalPlainDate("2026-07-10")).toBe(true);
  });

  test("rejects impossible and noncanonical dates", () => {
    expect(isCanonicalPlainDate("2026-02-30")).toBe(false);
    expect(isCanonicalPlainDate("2026-7-10")).toBe(false);
    expect(isCanonicalPlainDate("not-a-date")).toBe(false);
  });
});

describe("local date-time input conversion", () => {
  test("formats and parses values in the supplied time zone", () => {
    const instant = Temporal.Instant.from("2026-08-01T08:00:00Z");

    expect(
      temporalInstantToLocalDateTimeString({
        instant,
        timeZone: "Europe/Prague",
      })
    ).toBe("2026-08-01T10:00");
    expect(
      localDateTimeToTemporalInstantString({
        dateTime: "2026-08-01T10:00",
        timeZone: "Europe/Prague",
      })
    ).toBe("2026-08-01T08:00:00Z");
  });
});

describe("localDateTimeToInstant", () => {
  const timeZone = "Europe/Prague";

  test.each([
    ["summer time", "2026-08-01T10:00", "2026-08-01T08:00:00Z"],
    ["standard time", "2026-01-15T10:00", "2026-01-15T09:00:00Z"],
    [
      "a time skipped by the spring DST gap",
      "2026-03-29T02:30",
      "2026-03-29T01:30:00Z",
    ],
    [
      "a time repeated by the autumn DST overlap",
      "2026-10-25T02:30",
      "2026-10-25T00:30:00Z",
    ],
  ])("resolves %s in the supplied time zone", (_, dateTime, expected) => {
    const instant = localDateTimeToInstant({ dateTime, timeZone });

    expect(instant).toBeInstanceOf(Temporal.Instant);
    expect(instant.equals(Temporal.Instant.from(expected))).toBe(true);
  });
});

describe("parseInstant", () => {
  test("parses ISO strings with an offset", () => {
    expect(
      Option.map(parseInstant("2026-07-10T10:00:00+02:00"), String)
    ).toEqual(Option.some("2026-07-10T08:00:00Z"));
  });

  test("returns none for local and invalid strings", () => {
    expect(parseInstant("2026-07-10T10:00:00")).toEqual(Option.none());
    expect(parseInstant("not-an-instant")).toEqual(Option.none());
  });
});

describe("parsePlainDate", () => {
  test("parses calendar dates", () => {
    expect(Option.map(parsePlainDate("2026-07-10"), String)).toEqual(
      Option.some("2026-07-10")
    );
  });

  test("returns none for invalid dates", () => {
    expect(parsePlainDate("2026-02-30")).toEqual(Option.none());
    expect(parsePlainDate("not-a-date")).toEqual(Option.none());
  });
});

describe("getPlainDatesBetween", () => {
  test("returns inclusive dates across a month boundary", () => {
    const dates = getPlainDatesBetween(
      Temporal.PlainDate.from("2026-01-30"),
      Temporal.PlainDate.from("2026-02-02")
    );

    expect(dates.map(String)).toEqual([
      "2026-01-30",
      "2026-01-31",
      "2026-02-01",
      "2026-02-02",
    ]);
    expect(dates.every((date) => date instanceof Temporal.PlainDate)).toBe(
      true
    );
  });

  test("returns an empty list when the start follows the end", () => {
    expect(
      getPlainDatesBetween(
        Temporal.PlainDate.from("2026-02-02"),
        Temporal.PlainDate.from("2026-02-01")
      )
    ).toEqual([]);
  });

  test("returns one date when the start equals the end", () => {
    expect(
      getPlainDatesBetween(
        Temporal.PlainDate.from("2026-02-01"),
        Temporal.PlainDate.from("2026-02-01")
      ).map(String)
    ).toEqual(["2026-02-01"]);
  });
});
