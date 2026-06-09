import { Data } from "effect";

export class GoogleCalendarAPIError extends Data.TaggedError(
  "GoogleCalendarAPIError"
)<{
  readonly operation: string;
  readonly statusCode?: number;
  readonly message?: string;
  readonly cause?: unknown;
}> {}

export type GoogleCalendarError = GoogleCalendarAPIError;
