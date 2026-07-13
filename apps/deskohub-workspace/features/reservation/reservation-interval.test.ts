import "@/shared/polyfills/temporal";

import { describe, expect, test } from "bun:test";
import { Cause, Effect } from "effect";
import { reservationTimeZone } from "@/features/reservation/reservation-date";
import {
  getReservationIntervalValidationIssue,
  getReservationPragueDateRange,
  isDefaultReservationInterval,
  normalizeReservationInterval,
} from "./reservation-interval";
import { normalizeReservationIntervalFields } from "./reservation-interval-normalization";

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

  test("normalizes local overnight times to canonical instants", () => {
    expect(
      Effect.runSync(
        normalizeReservationInterval({
          date: "2099-06-10",
          startsAt: "22:00",
          endsAt: "02:00",
        })
      )
    ).toMatchObject({
      startsAt: "2099-06-10T20:00:00Z",
      endsAt: "2099-06-11T00:00:00Z",
    });
  });

  test("requires a date for local time inputs", () => {
    expect(
      getReservationIntervalValidationIssue({
        startsAt: "09:00",
        endsAt: "10:00",
      })
    ).toEqual({
      path: "startsAt",
      message: "Reservation date is required for local time inputs.",
    });
  });

  test("does not invent a date for an empty interval input", () => {
    expect(getReservationIntervalValidationIssue({})).toEqual({
      path: "startsAt",
      message: "Reservation date is required for local time inputs.",
    });
  });

  test("reports invalid normalization as a typed Effect failure without throwing on invocation", () => {
    expect(() =>
      normalizeReservationIntervalFields(
        {
          date: "2099-06-10",
          startsAt: "9:00",
          endsAt: "10:00",
        },
        reservationTimeZone
      )
    ).not.toThrow();

    const exit = Effect.runSyncExit(
      normalizeReservationIntervalFields(
        {
          date: "2099-06-10",
          startsAt: "9:00",
          endsAt: "10:00",
        },
        reservationTimeZone
      )
    );

    expect(exit._tag).toBe("Failure");
    if (exit._tag === "Failure") {
      expect(Cause.squash(exit.cause)).toMatchObject({
        _tag: "ReservationIntervalValidationError",
        message: "Reservation start and end must be valid timestamps.",
      });
    }
  });

  test("rejects non-canonical local time strings", () => {
    expect(
      getReservationIntervalValidationIssue({
        date: "2099-06-10",
        startsAt: "9:00",
        endsAt: "10:00",
      })
    ).toEqual({
      path: "startsAt",
      message: "Reservation start and end must be valid timestamps.",
    });
  });

  test("validates an expected duration against the normalized interval", () => {
    expect(
      getReservationIntervalValidationIssue({
        startsAt: "2099-06-10T07:00:00Z",
        endsAt: "2099-06-10T08:00:00Z",
        durationMinutes: 240,
      })
    ).toEqual({
      path: "endsAt",
      message: "Reservation duration must match start and end time.",
    });
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
