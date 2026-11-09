import { Data } from "effect";

const sealedStateTokenErrorTag = "SealedStateTokenError";

/**
 * Sealed state that can't be sealed or opened. `code` tells the cause apart:
 * the key ring is missing or invalid, the token is malformed, tampered with,
 * sealed for another purpose or with a key the ring doesn't hold, or expired.
 */
export class SealedStateTokenError extends Data.TaggedError(
  sealedStateTokenErrorTag
)<{
  readonly code:
    | "missing-secret"
    | "invalid-secret"
    | "invalid-token"
    | "unknown-kid"
    | "expired";
  readonly message: string;
  readonly cause?: unknown;
}> {
  static readonly _tag = sealedStateTokenErrorTag;
}

const sealedStateTooLargeErrorTag = "SealedStateTooLargeError";

/** The sealed token would be longer than its kind of state allows. */
export class SealedStateTooLargeError extends Data.TaggedError(
  sealedStateTooLargeErrorTag
)<{
  readonly maxTokenLength: number;
  readonly tokenLength: number;
}> {
  static readonly _tag = sealedStateTooLargeErrorTag;
}
