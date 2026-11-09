import { Data } from "effect";

/**
 * What a provider chain does with a request whose outcome is unknown:
 *
 * - `provider`: a timeout, a transport or server failure. The user accepted
 *   the duplicate risk, so the chain tries the next provider.
 * - `unknown-outcome`: an earlier request under the same idempotency key may
 *   still deliver, such as a key already in flight (HTTP 409). Another
 *   provider would send a duplicate, so the chain stops and the caller
 *   replays under the same key.
 */
export type NetworkFailureKind = "provider" | "unknown-outcome";

/**
 * A provider request whose outcome is unknown: a timeout, a transport or
 * server failure, a reused key, or an unreadable answer to an accepted
 * request. The provider surfaces it only after its own retries are spent.
 * `failureKind` (default `provider`) decides whether a provider chain
 * continues; `code` is a fixed, non-personal machine code such as `timeout`
 * or `http-503`.
 */
export class NetworkError extends Data.TaggedError("NetworkError")<{
  readonly message: string;
  readonly cause?: unknown;
  readonly url?: string;
  readonly code?: string;
  readonly failureKind?: NetworkFailureKind;
}> {}
