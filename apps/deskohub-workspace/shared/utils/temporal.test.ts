import { describe, expect, test } from "bun:test";
import "@/shared/polyfills/temporal";
import { Schema } from "effect";
import {
  instantStringEffectSchema,
  isFuturePlainDateTime,
  isPlainDateString,
  makeWholeHourInstantStringEffectSchema,
  temporalInstantToIsoString,
} from "./temporal";

describe("instantStringEffectSchema", () => {
  const isInstantString = Schema.is(instantStringEffectSchema);

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

describe("makeWholeHourInstantStringEffectSchema", () => {
  const isWholeHourInPrague = Schema.is(
    makeWholeHourInstantStringEffectSchema("Europe/Prague")
  );

  test("accepts instants that fall on a whole hour in the supplied time zone", () => {
    expect(isWholeHourInPrague("2026-07-10T08:00:00Z")).toBe(true);
  });

  test("rejects partial hours and invalid instants", () => {
    expect(isWholeHourInPrague("2026-07-10T08:00:00.001Z")).toBe(false);
    expect(isWholeHourInPrague("not-an-instant")).toBe(false);
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
  });
});

describe("temporalInstantToIsoString", () => {
  test("formats an instant as a JavaScript ISO timestamp", () => {
    expect(
      temporalInstantToIsoString(Temporal.Instant.from("2026-07-10T08:00:00Z"))
    ).toBe("2026-07-10T08:00:00.000Z");
  });
});
