import { Effect } from "effect";
import {
  type ReservationInterval,
  type ReservationIntervalInput,
  ReservationIntervalValidationError,
} from "./reservation-interval-domain";
import {
  normalizeTimestampField,
  toInstantMilliseconds,
} from "./reservation-interval-parser";

export const normalizeReservationIntervalFields = Effect.fn(
  "normalizeReservationIntervalFields"
)(function* (value: ReservationIntervalInput, timeZone: string) {
  const normalizedStartsAt = yield* normalizeTimestampField({
    path: "startsAt",
    timeZone,
    value: value.startsAt,
  });
  const normalizedEndsAt = yield* normalizeTimestampField({
    path: "endsAt",
    timeZone,
    value: value.endsAt,
  });

  const interval = {
    startsAt: normalizedStartsAt,
    endsAt: normalizedEndsAt,
  };
  const durationMinutes = getDurationMinutes(interval);

  if (durationMinutes <= 0) {
    return yield* Effect.fail(
      new ReservationIntervalValidationError({
        path: "endsAt",
        message: "Reservation end time must be after start time.",
      })
    );
  }

  return interval;
});

export const getDurationMinutes = (interval: ReservationInterval) =>
  (toInstantMilliseconds(interval.endsAt) -
    toInstantMilliseconds(interval.startsAt)) /
  (60 * 1000);
