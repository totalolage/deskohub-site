import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import {
  dotyposIdFilterBatchSize,
  readInIdFilterBatches,
} from "./id-filter-batches";

describe("readInIdFilterBatches", () => {
  test("reads unique ids in filter-sized batches and keeps batch order", async () => {
    const ids = Array.from(
      { length: dotyposIdFilterBatchSize + 2 },
      (_, index) => `id-${index}`
    );
    const read: string[][] = [];

    const results = await Effect.runPromise(
      readInIdFilterBatches([...ids, ids[0] as string], (batchIds) =>
        Effect.sync(() => {
          read.push([...batchIds]);
          return batchIds.length;
        })
      )
    );

    expect(read).toEqual([
      ids.slice(0, dotyposIdFilterBatchSize),
      ids.slice(dotyposIdFilterBatchSize),
    ]);
    expect(results).toEqual([dotyposIdFilterBatchSize, 2]);
  });

  test("reads nothing for no ids", async () => {
    let reads = 0;

    const results = await Effect.runPromise(
      readInIdFilterBatches([], () => Effect.sync(() => ++reads))
    );

    expect(results).toEqual([]);
    expect(reads).toBe(0);
  });

  test("fails the whole read when a batch lets its failure through", async () => {
    const ids = Array.from(
      { length: dotyposIdFilterBatchSize + 1 },
      (_, index) => `id-${index}`
    );

    const result = await Effect.runPromise(
      readInIdFilterBatches(ids, (batchIds) =>
        batchIds.length === 1 ? Effect.fail("batch failed") : Effect.void
      ).pipe(Effect.flip)
    );

    expect(result).toBe("batch failed");
  });
});
