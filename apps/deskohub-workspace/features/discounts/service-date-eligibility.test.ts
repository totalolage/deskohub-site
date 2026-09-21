import "@/shared/polyfills/temporal";
import { describe, expect, test } from "bun:test";
import { isReservationServiceDateEligible } from "./service-date-eligibility";

const window = (from: string | null, until: string | null) => ({
  serviceDateFrom: from,
  serviceDateUntil: until,
});

describe("reservation service date eligibility", () => {
  test.each([
    ["legacy code without a window", window(null, null), "2026-07-15"],
    [
      "reservation on the first day",
      window("2026-07-15", "2026-07-18"),
      "2026-07-15",
    ],
    [
      "reservation inside the window",
      window("2026-07-15", "2026-07-18"),
      "2026-07-16",
    ],
    [
      "reservation on the last excluded day boundary",
      window("2026-07-15", "2026-07-18"),
      "2026-07-17",
    ],
  ])("accepts %s", (_label, serviceDates, reservationDate) => {
    expect(
      isReservationServiceDateEligible(serviceDates, reservationDate)
    ).toBe(true);
  });

  test.each([
    [
      "reservation before the window",
      window("2026-07-15", "2026-07-18"),
      "2026-07-14",
    ],
    [
      "reservation on the exclusive end date",
      window("2026-07-15", "2026-07-18"),
      "2026-07-18",
    ],
    [
      "reservation after the window",
      window("2026-07-15", "2026-07-18"),
      "2026-07-19",
    ],
    [
      "invalid half-open window with a start",
      window("2026-07-15", null),
      "2026-07-15",
    ],
    [
      "invalid half-open window with an end",
      window(null, "2026-07-18"),
      "2026-07-15",
    ],
    [
      "noncanonical reservation date",
      window("2026-07-15", "2026-07-18"),
      "2026-7-15",
    ],
  ])("rejects %s", (_label, serviceDates, reservationDate) => {
    expect(
      isReservationServiceDateEligible(serviceDates, reservationDate)
    ).toBe(false);
  });

  test("accepts an overnight or multi-day reservation whose start is eligible even when its end passes the window", () => {
    expect(
      isReservationServiceDateEligible(
        window("2026-07-15", "2026-07-16"),
        "2026-07-15"
      )
    ).toBe(true);
  });

  test("rejects a window tightened after commitment that no longer contains the start", () => {
    expect(
      isReservationServiceDateEligible(
        window("2026-07-20", "2026-07-25"),
        "2026-07-15"
      )
    ).toBe(false);
  });
});
