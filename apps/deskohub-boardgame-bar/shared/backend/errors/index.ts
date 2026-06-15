import { Data } from "effect";

export class BackendError extends Data.TaggedError("BackendError")<{
  readonly code: string;
  readonly message: string;
  readonly cause: unknown;
  readonly details?: unknown;
}> {}

export class StorageError extends Data.TaggedError("StorageError")<{
  readonly message: string;
  readonly cause: unknown;
  readonly operation?: string;
}> {}

export class ValidationError extends Data.TaggedError("ValidationError")<{
  readonly message: string;
  readonly field?: string;
}> {}

export class ExternalAPIError extends Data.TaggedError("ExternalAPIError")<{
  readonly service: string;
  readonly operation: string;
  readonly statusCode?: number;
  readonly message?: string;
  readonly cause: unknown;
}> {}

export class NetworkError extends Data.TaggedError("NetworkError")<{
  readonly message: string;
  readonly cause: unknown;
  readonly url?: string;
}> {}

export class ParseError extends Data.TaggedError("ParseError")<{
  readonly message: string;
  readonly cause: unknown;
  readonly data?: unknown;
}> {}
