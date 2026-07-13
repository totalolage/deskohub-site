import { Data } from "effect";
import type { Instant } from "@/shared/utils/temporal";

export type ReservationInterval = {
  readonly startsAt: Instant;
  readonly endsAt: Instant;
};

export type ReservationIntervalInput = {
  readonly startsAt: string;
  readonly endsAt: string;
  readonly durationMinutes?: number;
  readonly date?: never;
};

export type ReservationDateInput = {
  readonly date: string;
  readonly startsAt?: never;
  readonly endsAt?: never;
  readonly durationMinutes?: never;
};

export type ReservationTimeInput =
  | ReservationDateInput
  | ReservationIntervalInput;

export type ReservationIntervalValidationIssue = {
  readonly path: keyof ReservationInterval;
  readonly message: string;
};

export class ReservationIntervalValidationError extends Data.TaggedError(
  "ReservationIntervalValidationError"
)<ReservationIntervalValidationIssue & { readonly cause?: unknown }> {}
