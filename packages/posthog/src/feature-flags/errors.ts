import { Data } from "effect";

export class PostHogFeatureFlagError extends Data.TaggedError(
  "PostHogFeatureFlagError"
)<{
  readonly message: string;
  readonly cause?: unknown;
  /** The HTTP status PostHog answered with, when it answered. */
  readonly httpStatus?: number;
  /** The failed step's tag, such as `TransportError` or `StatusCodeError`. */
  readonly failureCode?: string;
}> {}
