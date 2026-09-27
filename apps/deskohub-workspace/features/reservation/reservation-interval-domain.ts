import { Data } from "effect";
import { workspaceSiteConstants } from "@/shared/utils/site-constants";
import {
  type Instant,
  isMidnight,
  type LocalDateTime,
} from "@/shared/utils/temporal";

export type ReservationInterval = {
  readonly startsAt: Instant;
  readonly endsAt: Instant;
};

export type ReservationIntervalInput = {
  readonly startsAt: Instant | LocalDateTime;
  readonly endsAt: Instant | LocalDateTime;
  readonly date?: never;
};

export type ReservationDateInput = {
  readonly date: string;
  readonly startsAt?: never;
  readonly endsAt?: never;
};

export type ReservationTimeInput =
  | ReservationDateInput
  | ReservationIntervalInput;

export type ReservationIntervalValidationIssue = {
  readonly path: keyof ReservationInterval;
  readonly message: string;
};

export const isSingleDayReservationInterval = (interval: {
  readonly startsAt: ReservationInterval["startsAt"] | Temporal.Instant;
  readonly endsAt: ReservationInterval["endsAt"] | Temporal.Instant;
}) => {
  const start = Temporal.Instant.from(interval.startsAt)
    .toZonedDateTimeISO(workspaceSiteConstants.location.timeZone)
    .toPlainDateTime();
  const end = Temporal.Instant.from(interval.endsAt)
    .toZonedDateTimeISO(workspaceSiteConstants.location.timeZone)
    .toPlainDateTime();

  // Full Prague calendar day: midnight to the next midnight, including 23-
  // and 25-hour daylight-saving days.
  if (
    isMidnight(start) &&
    isMidnight(end) &&
    end.toPlainDate().equals(start.toPlainDate().add({ days: 1 }))
  ) {
    return true;
  }

  // Open Space day: Prague-local 00:00 until 17:00 on the same calendar date.
  return (
    isMidnight(start) &&
    start.hour === 0 &&
    start.minute === 0 &&
    end.hour === 17 &&
    end.minute === 0 &&
    end.toPlainDate().equals(start.toPlainDate())
  );
};

export class ReservationIntervalValidationError extends Data.TaggedError(
  "ReservationIntervalValidationError"
)<ReservationIntervalValidationIssue & { readonly cause?: unknown }> {}
