import "@/shared/polyfills/temporal";

import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import {
  getReservationIntervalValidationIssue,
  getReservationPragueDateRange,
  isDefaultReservationInterval,
} from "./reservation-interval";

describe("reservation intervals", () => {
  test("accepts overnight intervals", () => {
    expect(
      getReservationIntervalValidationIssue({
        date: "2099-06-10",
        startsAt: "22:00",
        endsAt: "02:00",
      })
    ).toBeNull();
  });

  test("converts rolling 24-hour reservations to a next-day range", () => {
    const range = Effect.runSync(
      getReservationPragueDateRange({
        startsAt: "2099-06-10T15:00",
        endsAt: "2099-06-11T15:00",
      })
    );

    expect(range.endMs - range.startMs).toBe(24 * 60 * 60 * 1000);
  });

  test("accepts explicit intervals starting on the reservation date", () => {
    expect(
      getReservationIntervalValidationIssue({
        date: "2099-06-10",
        startsAt: "2099-06-10T07:00:00Z",
        endsAt: "2099-06-10T08:00:00Z",
      })
    ).toBeNull();
  });

  test("rejects explicit intervals starting on a different reservation date", () => {
    expect(
      getReservationIntervalValidationIssue({
        date: "2099-06-10",
        startsAt: "2099-06-10T22:00:00Z",
        endsAt: "2099-06-10T23:00:00Z",
      })
    ).toEqual({
      path: "startsAt",
      message: "Reservation start time must match reservation date.",
    });
  });

  test("treats local midnight-to-midnight as full-day across DST changes", () => {
    expect(
      isDefaultReservationInterval({
        date: "2026-03-29",
        startsAt: "00:00",
        endsAt: "24:00",
      })
    ).toBeTrue();
  });
});
