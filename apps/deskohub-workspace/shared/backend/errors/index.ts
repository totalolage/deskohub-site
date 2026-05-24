import { Data } from "effect";

export class StorageError extends Data.TaggedError("StorageError")<{
  readonly message: string;
  readonly cause: unknown;
  readonly operation?: string;
}> {}
