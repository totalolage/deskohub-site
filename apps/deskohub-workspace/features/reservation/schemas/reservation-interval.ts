import "@/shared/polyfills/temporal";

import { Data, Effect, Schema } from "effect";
import { reservationTimeZone } from "@/features/reservation/reservation-date";
import { temporalInstantToPlainDate } from "@/shared/utils/temporal";

export type ReservationInterval = {
  readonly startsAt: string;
  readonly endsAt: string;
};

type ReservationIntervalInput = Partial<ReservationInterval> & {
  readonly date?: string;
  readonly durationMinutes?: number;
};

export type ReservationDateInterval = ReservationInterval & {
  readonly date: string;
};

export type ReservationDateRange = {
  readonly startDate: Date;
  readonly endDate: Date;
  readonly startMs: number;
  readonly endMs: number;
};

export class ReservationIntervalError extends Data.TaggedError(
  "ReservationIntervalError"
)<{ readonly message: string; readonly cause?: unknown }> {}

export const defaultReservationInterval = {
  startsAt: "00:00",
  endsAt: "24:00",
} as const satisfies ReservationInterval;

const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const endTimePattern = /^(?:(?:[01]\d|2[0-3]):[0-5]\d|24:00)$/;
const localDateTimePattern =
  /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/;

export const reservationIntervalFieldSchemas = {
  startsAt: Schema.optional(Schema.String),
  endsAt: Schema.optional(Schema.String),
} as const;

export const isDefaultReservationInterval = (
  interval: ReservationIntervalInput
) => {
  const hasExplicitInterval =
    interval.startsAt !== undefined || interval.endsAt !== undefined;
  const normalized = getNormalizedReservationInterval({
    ...(!hasExplicitInterval && { date: "2099-01-01" }),
    ...interval,
  });

  if (!normalized.ok) return false;

  const start = toPraguePlainDateTime(normalized.interval.startsAt);
  const end = toPraguePlainDateTime(normalized.interval.endsAt);
  const nextPragueDate = start.toPlainDate().add({ days: 1 }).toString();

  return (
    start.hour === 0 &&
    start.minute === 0 &&
    start.second === 0 &&
    start.millisecond === 0 &&
    end.hour === 0 &&
    end.minute === 0 &&
    end.second === 0 &&
    end.millisecond === 0 &&
    end.toPlainDate().toString() === nextPragueDate
  );
};

export const getReservationIntervalValidationIssue = (
  interval: ReservationIntervalInput
): {
  readonly path: keyof ReservationInterval;
  readonly message: string;
} | null => {
  const normalized = getNormalizedReservationInterval(interval);

  if (normalized.ok) return null;

  return normalized.issue;
};

export const unsafeNormalizeReservationInterval = <T extends object>(
  value: T
): Omit<T, "durationMinutes"> & ReservationInterval => {
  const normalized = getNormalizedReservationInterval(
    value as ReservationIntervalInput
  );

  if (!normalized.ok) throw new Error(normalized.issue.message);

  const { durationMinutes: _durationMinutes, ...rest } = value as T & {
    readonly durationMinutes?: number;
  };

  return { ...rest, ...normalized.interval } as Omit<T, "durationMinutes"> &
    ReservationInterval;
};

export const normalizeReservationInterval = Effect.fn(
  "normalizeReservationInterval"
)(function* <T extends object>(value: T) {
  return yield* Effect.try({
    try: () => unsafeNormalizeReservationInterval(value),
    catch: (cause) =>
      new ReservationIntervalError({
        message:
          cause instanceof Error
            ? cause.message
            : "Reservation start and end must be valid timestamps.",
        cause,
      }),
  });
});

export const getReservationPragueDateRange = (
  reservation: ReservationIntervalInput
): Effect.Effect<ReservationDateRange, ReservationIntervalError> =>
  Effect.try({
    try: () => {
      const interval = unsafeNormalizeReservationInterval(reservation);
      const startMs = toInstantMs(interval.startsAt);
      const endMs = toInstantMs(interval.endsAt);

      if (endMs <= startMs) {
        throw new Error("Reservation end time must be after start time.");
      }

      return {
        startDate: new Date(startMs),
        endDate: new Date(endMs),
        startMs,
        endMs,
      };
    },
    catch: (cause) =>
      new ReservationIntervalError({
        message:
          cause instanceof Error
            ? cause.message
            : "Reservation start and end must be valid timestamps.",
        cause,
      }),
  });

export const getReservationDurationMinutes = (
  interval: ReservationInterval
) => {
  const duration =
    toInstantMs(interval.endsAt) - toInstantMs(interval.startsAt);

  return duration / (60 * 1000);
};

export const getReservationPragueDate = (interval: ReservationInterval) =>
  temporalInstantToPlainDate({
    instant: Temporal.Instant.from(interval.startsAt),
    timeZone: reservationTimeZone,
  }).toString();

export const reservationDateRangesOverlap = (
  left: Pick<ReservationDateRange, "startMs" | "endMs">,
  right: Pick<ReservationDateRange, "startMs" | "endMs">
) => left.startMs < right.endMs && left.endMs > right.startMs;

const getNormalizedReservationInterval = (
  value: ReservationIntervalInput
):
  | { readonly ok: true; readonly interval: ReservationInterval }
  | {
      readonly ok: false;
      readonly issue: {
        readonly path: keyof ReservationInterval;
        readonly message: string;
      };
    } => {
  const hasExplicitInterval =
    value.startsAt !== undefined || value.endsAt !== undefined;
  const startsAt = value.startsAt || defaultReservationInterval.startsAt;
  const endsAt = value.endsAt || defaultReservationInterval.endsAt;
  const date = value.date ?? (hasExplicitInterval ? undefined : "2099-01-01");

  if (!startsAt) {
    return {
      ok: false,
      issue: { path: "startsAt", message: "Reservation start is required." },
    };
  }

  if (!endsAt) {
    return {
      ok: false,
      issue: { path: "endsAt", message: "Reservation end is required." },
    };
  }

  const normalizedStartsAt = normalizeReservationTimestamp(date, startsAt);
  if (!normalizedStartsAt.ok) {
    return {
      ok: false,
      issue: {
        path: "startsAt",
        message: normalizedStartsAt.message,
      },
    };
  }

  const normalizedEndsAt = normalizeReservationTimestamp(
    date,
    endsAt,
    startsAt
  );
  if (!normalizedEndsAt.ok) {
    return {
      ok: false,
      issue: {
        path: "endsAt",
        message: normalizedEndsAt.message,
      },
    };
  }

  try {
    const interval = {
      startsAt: normalizedStartsAt.value,
      endsAt: normalizedEndsAt.value,
    };
    const durationMinutes = getReservationDurationMinutes(interval);

    if (durationMinutes <= 0) {
      return {
        ok: false,
        issue: {
          path: "endsAt",
          message: "Reservation end time must be after start time.",
        },
      };
    }

    if (
      value.date &&
      hasExplicitInterval &&
      toPraguePlainDateTime(interval.startsAt).toPlainDate().toString() !==
        value.date
    ) {
      return {
        ok: false,
        issue: {
          path: "startsAt",
          message: "Reservation start time must match reservation date.",
        },
      };
    }

    if (
      value.durationMinutes !== undefined &&
      durationMinutes !== value.durationMinutes
    ) {
      return {
        ok: false,
        issue: {
          path: "endsAt",
          message: "Reservation duration must match start and end time.",
        },
      };
    }

    return { ok: true, interval };
  } catch (cause) {
    return {
      ok: false,
      issue: {
        path: "endsAt",
        message:
          cause instanceof Error
            ? cause.message
            : "Reservation start and end must be valid timestamps.",
      },
    };
  }
};

type ReservationTimestampResult =
  | {
      readonly ok: true;
      readonly value: string;
    }
  | {
      readonly ok: false;
      readonly message: string;
    };

const normalizeReservationTimestamp = (
  date: string | undefined,
  value: string,
  startsAt?: string
): ReservationTimestampResult => {
  if (timePattern.test(value) || value === "24:00") {
    if (!date) {
      return {
        ok: false,
        message: "Reservation date is required for local time inputs.",
      };
    }

    const timestamp = timeToPragueIso(date, value, startsAt);
    return timestamp
      ? { ok: true, value: timestamp }
      : {
          ok: false,
          message: "Reservation time must use HH:mm format.",
        };
  }

  try {
    if (localDateTimePattern.test(value)) {
      return {
        ok: true,
        value: plainDateTimeToPragueIso(Temporal.PlainDateTime.from(value)),
      };
    }

    return { ok: true, value: Temporal.Instant.from(value).toString() };
  } catch (cause) {
    return {
      ok: false,
      message:
        cause instanceof Error
          ? cause.message
          : "Reservation start and end must be valid timestamps.",
    };
  }
};

const timeToPragueIso = (date: string, time: string, startsAt?: string) => {
  const reservationDate = Temporal.PlainDate.from(date);
  const minutes = timeToMinutes(time);
  const startMinutes = startsAt ? timeToMinutes(startsAt) : undefined;
  if (minutes === null || startMinutes === null) return null;

  const localDate = reservationDate.add({
    days:
      time !== "24:00" && startMinutes !== undefined && minutes <= startMinutes
        ? 1
        : Math.floor(minutes / (24 * 60)),
  });
  const localMinutes = minutes % (24 * 60);
  const plainTime = new Temporal.PlainTime(
    Math.floor(localMinutes / 60),
    localMinutes % 60
  );

  return plainDateTimeToPragueIso(localDate.toPlainDateTime(plainTime));
};

const plainDateTimeToPragueIso = (dateTime: {
  toZonedDateTime: (timeZone: string) => {
    toInstant: () => { toString: () => string };
  };
}) => dateTime.toZonedDateTime(reservationTimeZone).toInstant().toString();

const toInstantMs = (value: string) =>
  Temporal.Instant.from(value).epochMilliseconds;

const toPraguePlainDateTime = (value: string) =>
  Temporal.Instant.from(value)
    .toZonedDateTimeISO(reservationTimeZone)
    .toPlainDateTime();

const timeToMinutes = (time: string) => {
  if (time === "24:00") return 24 * 60;
  if (!endTimePattern.test(time)) return null;

  const [hours = "0", minutes = "0"] = time.split(":");
  return Number(hours) * 60 + Number(minutes);
};
