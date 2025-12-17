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
}> {
  get code() {
    return "STORAGE_ERROR";
  }
}

export class ValidationError extends Data.TaggedError("ValidationError")<{
  readonly message: string;
  readonly field?: string;
}> {
  get code() {
    return "VALIDATION_ERROR";
  }
}

export class ExternalAPIError extends Data.TaggedError("ExternalAPIError")<{
  readonly service: string;
  readonly message: string;
  readonly cause: unknown;
  readonly statusCode?: number;
}> {
  get code() {
    return "EXTERNAL_API_ERROR";
  }
}

export class NetworkError extends Data.TaggedError("NetworkError")<{
  readonly message: string;
  readonly cause: unknown;
  readonly url?: string;
}> {
  get code() {
    return "NETWORK_ERROR";
  }
}

export class ParseError extends Data.TaggedError("ParseError")<{
  readonly message: string;
  readonly cause: unknown;
  readonly data?: unknown;
}> {
  get code() {
    return "PARSE_ERROR";
  }
}
