import { Data } from "effect";
import type { InstantString } from "@/shared/utils/temporal";

export type ReservationInterval = {
  readonly startsAt: InstantString;
  readonly endsAt: InstantString;
};

export type ReservationIntervalInput = {
  readonly startsAt?: string;
  readonly endsAt?: string;
  readonly date?: string;
  readonly durationMinutes?: number;
};

export type ReservationIntervalValidationIssue = {
  readonly path: keyof ReservationInterval;
  readonly message: string;
};

export const defaultReservationInterval: Required<
  Pick<ReservationIntervalInput, "startsAt" | "endsAt">
> = {
  startsAt: "00:00",
  endsAt: "24:00",
};

export class ReservationIntervalValidationError extends Data.TaggedError(
  "ReservationIntervalValidationError"
)<ReservationIntervalValidationIssue & { readonly cause?: unknown }> {}
