import { Effect } from "effect";
import {
  defaultReservationInterval,
  type ReservationInterval,
  type ReservationIntervalInput,
  ReservationIntervalValidationError,
} from "./reservation-interval-domain";
import {
  normalizeTimestampField,
  toInstantMilliseconds,
  toPlainDateTime,
} from "./reservation-interval-parser";

export const normalizeReservationIntervalFields = (
  value: ReservationIntervalInput,
  timeZone: string
): Effect.Effect<ReservationInterval, ReservationIntervalValidationError> =>
  Effect.gen(function* () {
    const hasExplicitInterval =
      value.startsAt !== undefined || value.endsAt !== undefined;
    const startsAt = value.startsAt ?? defaultReservationInterval.startsAt;
    const endsAt = value.endsAt ?? defaultReservationInterval.endsAt;
    const date = value.date;

    const normalizedStartsAt = yield* normalizeTimestampField({
      date,
      path: "startsAt",
      timeZone,
      value: startsAt,
    });
    const normalizedEndsAt = yield* normalizeTimestampField({
      date,
      path: "endsAt",
      startsAt,
      timeZone,
      value: endsAt,
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

    if (
      value.date &&
      hasExplicitInterval &&
      toPlainDateTime(interval.startsAt, timeZone).toPlainDate().toString() !==
        value.date
    ) {
      return yield* Effect.fail(
        new ReservationIntervalValidationError({
          path: "startsAt",
          message: "Reservation start time must match reservation date.",
        })
      );
    }

    if (
      value.durationMinutes !== undefined &&
      durationMinutes !== value.durationMinutes
    ) {
      return yield* Effect.fail(
        new ReservationIntervalValidationError({
          path: "endsAt",
          message: "Reservation duration must match start and end time.",
        })
      );
    }

    return interval;
  });

export const getDurationMinutes = (interval: ReservationInterval) =>
  (toInstantMilliseconds(interval.endsAt) -
    toInstantMilliseconds(interval.startsAt)) /
  (60 * 1000);

export type {
  ReservationInterval,
  ReservationIntervalInput,
  ReservationIntervalValidationIssue,
} from "./reservation-interval-domain";
export {
  defaultReservationInterval,
  ReservationIntervalValidationError,
} from "./reservation-interval-domain";
export {
  toInstantMilliseconds,
  toPlainDateTime,
} from "./reservation-interval-parser";
