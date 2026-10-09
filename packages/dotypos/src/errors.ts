import { Data } from "effect";
import type { DotyposReservationId } from "./types";

export class ValidationError extends Data.TaggedError("ValidationError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class DotyposReservationCancelledError extends Data.TaggedError(
  "DotyposReservationCancelledError"
)<{
  readonly reservationId: DotyposReservationId;
  readonly message: string;
}> {}

export type DotyposProviderError = {
  readonly error?: string;
  readonly errorDescription?: string;
  readonly code?: number;
};

export class ExternalAPIError extends Data.TaggedError("ExternalAPIError")<{
  readonly service: string;
  readonly operation: string;
  readonly statusCode?: number;
  readonly message?: string;
  readonly providerError?: DotyposProviderError;
  readonly cause?: unknown;
}> {}

export class NetworkError extends Data.TaggedError("NetworkError")<{
  readonly message: string;
  readonly url?: string;
  readonly cause?: unknown;
}> {}
