import "@/shared/polyfills/temporal";

import { describe, expect, test } from "bun:test";
import { Effect, Schema } from "effect";
import {
  getReservationIntervalValidationIssue,
  isSingleDayReservationInterval,
  normalizeReservationInterval,
  reservationIntervalInputSchema,
} from "./reservation-interval";
import { getDurationMinutes } from "./reservation-interval-normalization";

const decodeInterval = Schema.decodeUnknownSync(reservationIntervalInputSchema);

describe("reservation intervals", () => {
  test("accepts overnight intervals", () => {
    expect(
      Effect.runSync(
        getReservationIntervalValidationIssue(
          decodeInterval({
            startsAt: "2099-06-10T22:00",
            endsAt: "2099-06-11T02:00",
          })
        )
      )
    ).toBeNull();
  });

  test("normalizes local overnight date-times to canonical instants", () => {
    expect(
      Effect.runSync(
        normalizeReservationInterval(
          decodeInterval({
            startsAt: "2099-06-10T22:00",
            endsAt: "2099-06-11T02:00",
          })
        )
      )
    ).toMatchObject({
      startsAt: "2099-06-10T20:00:00Z",
      endsAt: "2099-06-11T00:00:00Z",
    });
  });

  test("rejects non-canonical timestamps at the schema boundary", () => {
    expect(
      Schema.is(reservationIntervalInputSchema)({
        date: "2099-06-10",
        startsAt: "9:00",
        endsAt: "10:00",
      })
    ).toBeFalse();
  });

  test("normalizes rolling 24-hour reservations", () => {
    const interval = Effect.runSync(
      normalizeReservationInterval(
        decodeInterval({
          startsAt: "2099-06-10T15:00",
          endsAt: "2099-06-11T15:00",
        })
      )
    );

    expect(interval).toEqual({
      startsAt: "2099-06-10T13:00:00Z",
      endsAt: "2099-06-11T13:00:00Z",
    });
    expect(getDurationMinutes(interval)).toBe(24 * 60);
  });

  test("accepts explicit instant intervals", () => {
    expect(
      Effect.runSync(
        getReservationIntervalValidationIssue(
          decodeInterval({
            startsAt: "2099-06-10T07:00:00Z",
            endsAt: "2099-06-10T08:00:00Z",
          })
        )
      )
    ).toBeNull();
  });

  test("treats local midnight-to-midnight as full-day across DST changes", () => {
    expect(
      isSingleDayReservationInterval(
        Effect.runSync(
          normalizeReservationInterval(
            decodeInterval({
              startsAt: "2026-03-29T00:00",
              endsAt: "2026-03-30T00:00",
            })
          )
        )
      )
    ).toBeTrue();
  });
});
