import { Data } from "effect";

export class GamesRequestError extends Data.TaggedError("GamesRequestError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}
