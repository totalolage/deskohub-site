import { Data } from "effect";

export class PostHogConfigError extends Data.TaggedError("PostHogConfigError")<{
  readonly message: string;
}> {}

export class PostHogRequestError extends Data.TaggedError(
  "PostHogRequestError"
)<{
  readonly message: string;
  readonly statusCode?: number;
}> {}
