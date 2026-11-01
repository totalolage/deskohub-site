import { Array as Arr, Effect } from "effect";
import type { Concurrency } from "effect/Types";
import type { DotyposOperation, DotyposReadFailure } from "../errors";
import { dotyposIdReadBatchSize } from "../id-reads";
import { dotyposInvalidRequest } from "./failure-classification";

export interface DotyposIdReadOptions {
  readonly concurrency?: Concurrency;
  /** Recover only this failed batch, retaining successful batches. Omit to fail the read. */
  readonly onBatchFailure?: (
    failure: DotyposReadFailure
  ) => Effect.Effect<void>;
}

export const readByIds = <Id extends string, A extends { readonly id?: Id }>(
  ids: Iterable<Id>,
  operation: DotyposOperation,
  read: (ids: readonly Id[]) => Effect.Effect<readonly A[], DotyposReadFailure>,
  options: DotyposIdReadOptions = {}
): Effect.Effect<ReadonlyMap<Id, A>, DotyposReadFailure> =>
  Effect.suspend(() => {
    const uniqueIds = [...new Set(ids)];
    if (uniqueIds.some((id) => !id.trim() || /[|;,]/.test(id))) {
      return Effect.fail(
        dotyposInvalidRequest(operation, "ID filters contain an invalid value")
      );
    }
    return Effect.forEach(
      Arr.chunksOf(uniqueIds, dotyposIdReadBatchSize),
      (batch) =>
        read(batch).pipe(
          Effect.catch((failure) =>
            options.onBatchFailure
              ? options
                  .onBatchFailure(failure)
                  .pipe(Effect.as([] as readonly A[]))
              : Effect.fail(failure)
          )
        ),
      { concurrency: options.concurrency ?? "inherit" }
    ).pipe(
      Effect.map(
        (batches) =>
          new Map(
            batches
              .flat()
              .flatMap((record) =>
                record.id === undefined ? [] : [[record.id, record] as const]
              )
          )
      )
    );
  });
