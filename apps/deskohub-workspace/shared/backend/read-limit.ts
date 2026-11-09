import { Data, Effect } from "effect";

/**
 * A bounded read found more rows than its caller's limit allows. The reader
 * fetched one row past the limit, so this proves an overflow instead of
 * guessing one; callers fail closed rather than return a truncated list.
 */
export class ReadLimitExceededError extends Data.TaggedError(
  "ReadLimitExceededError"
)<{
  readonly limit: number;
}> {}

/**
 * The row count a bounded read fetches: one sentinel row past the limit, so
 * an overflow is observable without counting the whole result.
 */
export const readLimitSentinel = (limit: number) => limit + 1;

/**
 * Fails with `ReadLimitExceededError` when a bounded read returned more rows
 * than `limit`, before any row reaches the caller.
 */
export const requireWithinReadLimit = <Row>(
  rows: readonly Row[],
  limit: number
): Effect.Effect<readonly Row[], ReadLimitExceededError> =>
  rows.length > limit
    ? Effect.fail(new ReadLimitExceededError({ limit }))
    : Effect.succeed(rows);
