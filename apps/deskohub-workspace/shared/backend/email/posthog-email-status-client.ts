// seam: status client from @deskohub/email-posthog
import { Data, type Duration, Effect, type Redacted } from "effect";

/** PostHog's status of one transactional email. */
export type PostHogEmailStatus =
  | "queued"
  | "sent"
  | "failed"
  | "delivered"
  | "bounced"
  | "complained";

/** PostHog's report of one email's current status. */
export interface PostHogEmailStatusReport {
  readonly messageId: string;
  readonly status: PostHogEmailStatus;
  readonly createdAt: Date;
  readonly statusAt: Date | null;
  readonly reason: string | null;
}

/** A status read, or PostHog not knowing the message yet. */
export type PostHogEmailStatusLookup =
  | { readonly _tag: "Found"; readonly report: PostHogEmailStatusReport }
  | { readonly _tag: "NotFoundYet" };

/** Why PostHog gave no status. */
export class PostHogEmailStatusError extends Data.TaggedError(
  "PostHogEmailStatusError"
)<{
  readonly reason:
    | "rate-limited"
    | "unauthorized"
    | "rejected"
    | "unavailable"
    | "invalid-response";
  readonly retryAfterSeconds?: number;
  readonly cause?: unknown;
}> {}

export interface PostHogEmailStatusClientConfig {
  readonly secretKey: Redacted.Redacted<string>;
  readonly host: string;
  readonly timeout?: Duration.Input;
}

/** Reads PostHog's status of one email by its message ID. */
export const fetchPostHogEmailStatus = (
  _config: PostHogEmailStatusClientConfig,
  _messageId: string
): Effect.Effect<PostHogEmailStatusLookup, PostHogEmailStatusError> =>
  Effect.die("fetchPostHogEmailStatus is not implemented yet");
