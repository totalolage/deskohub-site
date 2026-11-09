import "@/shared/polyfills/temporal";
import { describe, expect, test } from "bun:test";
import { plainDateStringSchema } from "@/shared/utils/temporal";
import {
  getServiceDateWindowIssue,
  isFirstServiceDateEligible,
  type ServiceDateWindow,
} from "./service-date-eligibility";

const date = plainDateStringSchema.make;

const window = (from: string, until: string): ServiceDateWindow => ({
  serviceDateFrom: date(from),
  serviceDateUntil: date(until),
});

const unrestricted: ServiceDateWindow = {
  serviceDateFrom: null,
  serviceDateUntil: null,
};

describe("isFirstServiceDateEligible", () => {
  test("covers every start date when the code has no window", () => {
    expect(isFirstServiceDateEligible(unrestricted, "2026-01-01")).toBe(true);
    expect(isFirstServiceDateEligible(unrestricted, "2099-12-31")).toBe(true);
  });

  test("includes both the first and the last date", () => {
    const july = window("2026-07-01", "2026-07-31");

    expect(isFirstServiceDateEligible(july, "2026-06-30")).toBe(false);
    expect(isFirstServiceDateEligible(july, "2026-07-01")).toBe(true);
    expect(isFirstServiceDateEligible(july, "2026-07-15")).toBe(true);
    expect(isFirstServiceDateEligible(july, "2026-07-31")).toBe(true);
    expect(isFirstServiceDateEligible(july, "2026-08-01")).toBe(false);
  });

  test("covers exactly one day when both dates are equal", () => {
    const oneDay = window("2026-07-15", "2026-07-15");

    expect(isFirstServiceDateEligible(oneDay, "2026-07-14")).toBe(false);
    expect(isFirstServiceDateEligible(oneDay, "2026-07-15")).toBe(true);
    expect(isFirstServiceDateEligible(oneDay, "2026-07-16")).toBe(false);
  });

  test("fails closed for a stored half window", () => {
    expect(
      isFirstServiceDateEligible(
        { serviceDateFrom: date("2026-07-01"), serviceDateUntil: null },
        "2026-07-15"
      )
    ).toBe(false);
    expect(
      isFirstServiceDateEligible(
        { serviceDateFrom: null, serviceDateUntil: date("2026-07-31") },
        "2026-07-15"
      )
    ).toBe(false);
  });

  test("fails closed for an inverted window", () => {
    expect(
      isFirstServiceDateEligible(
        window("2026-07-31", "2026-07-01"),
        "2026-07-15"
      )
    ).toBe(false);
  });

  test("fails closed for a non-canonical reservation date", () => {
    const july = window("2026-07-01", "2026-07-31");

    for (const reservationDate of [
      "2026-7-15",
      "2026-07-15T00:00",
      "20260715",
      "",
    ]) {
      expect(isFirstServiceDateEligible(july, reservationDate)).toBe(false);
    }
  });
});

describe("getServiceDateWindowIssue", () => {
  test("accepts an empty window, a one-day window, and an ordered window", () => {
    expect(getServiceDateWindowIssue(unrestricted)).toBeUndefined();
    expect(
      getServiceDateWindowIssue(window("2026-07-15", "2026-07-15"))
    ).toBeUndefined();
    expect(
      getServiceDateWindowIssue(window("2026-07-01", "2026-07-31"))
    ).toBeUndefined();
  });

  test("rejects half and inverted windows", () => {
    expect(
      getServiceDateWindowIssue({
        serviceDateFrom: date("2026-07-01"),
        serviceDateUntil: null,
      })
    ).toBeString();
    expect(
      getServiceDateWindowIssue({
        serviceDateFrom: null,
        serviceDateUntil: date("2026-07-01"),
      })
    ).toBeString();
    expect(
      getServiceDateWindowIssue(window("2026-07-02", "2026-07-01"))
    ).toBeString();
  });
});
