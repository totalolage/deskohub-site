import { Data } from "effect";

export class GoogleCalendarAPIError extends Data.TaggedError(
  "GoogleCalendarAPIError"
)<{
  readonly operation: string;
  readonly statusCode?: number;
  readonly message?: string;
  readonly cause?: unknown;
}> {}

export class GoogleCalendarConfigError extends Data.TaggedError(
  "GoogleCalendarConfigError"
)<{
  readonly message: string;
  readonly field: string;
}> {}

export type GoogleCalendarError =
  | GoogleCalendarAPIError
  | GoogleCalendarConfigError;
