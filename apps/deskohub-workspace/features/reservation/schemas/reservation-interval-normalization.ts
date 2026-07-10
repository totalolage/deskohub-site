import { normalizeReservationTimestamp } from "@/features/reservation/schemas/reservation-timestamp";

export type ReservationInterval = {
  readonly startsAt: string;
  readonly endsAt: string;
};

export type ReservationIntervalInput = Partial<ReservationInterval> & {
  readonly date?: string;
  readonly durationMinutes?: number;
};

export type ReservationIntervalValidationIssue = {
  readonly path: keyof ReservationInterval;
  readonly message: string;
};

export class ReservationIntervalValidationError extends Error {
  readonly path: keyof ReservationInterval;

  constructor(
    issue: ReservationIntervalValidationIssue,
    options?: ErrorOptions
  ) {
    super(issue.message, options);
    this.name = "ReservationIntervalValidationError";
    this.path = issue.path;
  }
}

export const defaultReservationInterval = {
  startsAt: "00:00",
  endsAt: "24:00",
} as const satisfies ReservationInterval;

export const normalizeReservationIntervalFields = (
  value: ReservationIntervalInput,
  timeZone: string
): ReservationInterval => {
  const hasExplicitInterval =
    value.startsAt !== undefined || value.endsAt !== undefined;
  const startsAt = value.startsAt ?? defaultReservationInterval.startsAt;
  const endsAt = value.endsAt ?? defaultReservationInterval.endsAt;
  const date = value.date ?? (hasExplicitInterval ? undefined : "2099-01-01");
  const normalizedStartsAt = normalizeTimestampField({
    date,
    path: "startsAt",
    timeZone,
    value: startsAt,
  });
  const normalizedEndsAt = normalizeTimestampField({
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
    throw new ReservationIntervalValidationError({
      path: "endsAt",
      message: "Reservation end time must be after start time.",
    });
  }

  if (
    value.date &&
    hasExplicitInterval &&
    toPlainDateTime(interval.startsAt, timeZone).toPlainDate().toString() !==
      value.date
  ) {
    throw new ReservationIntervalValidationError({
      path: "startsAt",
      message: "Reservation start time must match reservation date.",
    });
  }

  if (
    value.durationMinutes !== undefined &&
    durationMinutes !== value.durationMinutes
  ) {
    throw new ReservationIntervalValidationError({
      path: "endsAt",
      message: "Reservation duration must match start and end time.",
    });
  }

  return interval;
};

export const getDurationMinutes = (interval: ReservationInterval) =>
  (toInstantMilliseconds(interval.endsAt) -
    toInstantMilliseconds(interval.startsAt)) /
  (60 * 1000);

export const toInstantMilliseconds = (value: string) =>
  Temporal.Instant.from(value).epochMilliseconds;

export const toPlainDateTime = (value: string, timeZone: string) =>
  Temporal.Instant.from(value).toZonedDateTimeISO(timeZone).toPlainDateTime();

const normalizeTimestampField = ({
  date,
  path,
  startsAt,
  timeZone,
  value,
}: {
  readonly date?: string;
  readonly path: keyof ReservationInterval;
  readonly startsAt?: string;
  readonly timeZone: string;
  readonly value: string;
}) => {
  try {
    return normalizeReservationTimestamp({
      date,
      startsAt,
      timeZone,
      value,
    });
  } catch (cause) {
    throw new ReservationIntervalValidationError(
      {
        path,
        message:
          cause instanceof Error
            ? cause.message
            : "Reservation start and end must be valid timestamps.",
      },
      { cause }
    );
  }
};
