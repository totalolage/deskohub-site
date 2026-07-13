import "@/shared/polyfills/temporal";

import { describe, expect, test } from "bun:test";
import { Effect, Schema } from "effect";
import {
  getReservationIntervalValidationIssue,
  getReservationPragueDateRange,
  isDefaultReservationInterval,
  normalizeReservationInterval,
  reservationIntervalInputEffectSchema,
} from "./reservation-interval";

const decodeInterval = Schema.decodeUnknownSync(
  reservationIntervalInputEffectSchema
);

describe("reservation intervals", () => {
  test("accepts overnight intervals", () => {
    expect(
      getReservationIntervalValidationIssue(
        decodeInterval({
          startsAt: "2099-06-10T22:00",
          endsAt: "2099-06-11T02:00",
        })
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
      Schema.is(reservationIntervalInputEffectSchema)({
        date: "2099-06-10",
        startsAt: "9:00",
        endsAt: "10:00",
      })
    ).toBeFalse();
  });

  test("converts rolling 24-hour reservations to a next-day range", () => {
    const range = Effect.runSync(
      normalizeReservationInterval(
        decodeInterval({
          startsAt: "2099-06-10T15:00",
          endsAt: "2099-06-11T15:00",
        })
      ).pipe(Effect.flatMap(getReservationPragueDateRange))
    );

    expect(range.endMs - range.startMs).toBe(24 * 60 * 60 * 1000);
  });

  test("accepts explicit instant intervals", () => {
    expect(
      getReservationIntervalValidationIssue(
        decodeInterval({
          startsAt: "2099-06-10T07:00:00Z",
          endsAt: "2099-06-10T08:00:00Z",
        })
      )
    ).toBeNull();
  });

  test("treats local midnight-to-midnight as full-day across DST changes", () => {
    expect(
      isDefaultReservationInterval(
        decodeInterval({
          startsAt: "2026-03-29T00:00",
          endsAt: "2026-03-30T00:00",
        })
      )
    ).toBeTrue();
  });
});
