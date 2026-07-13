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
        startsAt: "2099-06-10T22:00",
        endsAt: "2099-06-11T02:00",
      })
    ).toBeNull();
  });

  test("normalizes local overnight date-times to canonical instants", () => {
    expect(
      Effect.runSync(
        normalizeReservationInterval({
          startsAt: "2099-06-10T22:00",
          endsAt: "2099-06-11T02:00",
        })
      )
    ).toMatchObject({
      startsAt: "2099-06-10T20:00:00Z",
      endsAt: "2099-06-11T00:00:00Z",
    });
  });

  test("reports invalid normalization as a typed Effect failure without throwing on invocation", () => {
    expect(() =>
      normalizeReservationIntervalFields(
        {
          startsAt: "2099-06-10T9:00",
          endsAt: "2099-06-10T10:00",
        },
        reservationTimeZone
      )
    ).not.toThrow();

    const exit = Effect.runSyncExit(
      normalizeReservationIntervalFields(
        {
          startsAt: "2099-06-10T9:00",
          endsAt: "2099-06-10T10:00",
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

  test("rejects non-canonical local date-time strings", () => {
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

  test("accepts explicit instant intervals", () => {
    expect(
      getReservationIntervalValidationIssue({
        startsAt: "2099-06-10T07:00:00Z",
        endsAt: "2099-06-10T08:00:00Z",
      })
    ).toBeNull();
  });

  test("treats local midnight-to-midnight as full-day across DST changes", () => {
    expect(
      isDefaultReservationInterval({
        startsAt: "2026-03-29T00:00",
        endsAt: "2026-03-30T00:00",
      })
    ).toBeTrue();
  });
});
