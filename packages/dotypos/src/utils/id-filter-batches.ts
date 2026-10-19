import { Effect, Array as EffectArray } from "effect";
import type { Concurrency } from "effect/Types";

/** How many ids one Dotypos `id|in|` filter carries, keeping its URL short. */
export const dotyposIdFilterBatchSize = 50;

/**
 * Reads the unique ids through Dotypos `id|in|` filters of
 * {@link dotyposIdFilterBatchSize} ids each and returns every batch's result
 * in batch order. `read` owns the failure policy of its batch: a failure it
 * lets through fails the whole read.
 */
export const readInIdFilterBatches = <Id, A, E, R>(
  ids: Iterable<Id>,
  read: (batchIds: readonly Id[]) => Effect.Effect<A, E, R>,
  options: { readonly concurrency?: Concurrency } = {}
): Effect.Effect<A[], E, R> =>
  Effect.forEach(
    EffectArray.chunksOf([...new Set(ids)], dotyposIdFilterBatchSize),
    read,
    { concurrency: options.concurrency ?? "inherit" }
  );
