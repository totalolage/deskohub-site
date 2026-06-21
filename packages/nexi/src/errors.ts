import { Data } from "effect";

export class ExternalAPIError extends Data.TaggedError("ExternalAPIError")<{
  readonly service: string;
  readonly operation: string;
  readonly statusCode?: number;
  readonly message?: string;
  readonly cause?: unknown;
}> {}

export class NetworkError extends Data.TaggedError("NetworkError")<{
  readonly message: string;
  readonly url?: string;
  readonly cause?: unknown;
}> {}
