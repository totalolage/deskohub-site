import { Data } from "effect";

export class PostHogFeatureFlagError extends Data.TaggedError(
  "PostHogFeatureFlagError"
)<{
  readonly message: string;
  readonly cause?: unknown;
}> {}
