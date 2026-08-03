import { expect, test } from "bun:test";
import {
  makeWorkspaceE2EDateAllocation,
  workspaceE2EConcurrentRunTarget,
  workspaceE2EFullDateAllocation,
} from "./allocation";

test("partitions the candidate range into deterministic disjoint shards", () => {
  const allocations = Array.from(
    { length: workspaceE2EConcurrentRunTarget },
    (_, shardIndex) =>
      makeWorkspaceE2EDateAllocation({
        prNumber: shardIndex + 1,
        runId: `run-${shardIndex}`,
      })
  );
  const allocatedOffsets = allocations.flatMap((allocation) =>
    Array.from(
      {
        length: allocation.toOffsetDays - allocation.fromOffsetDays + 1,
      },
      (_, index) => allocation.fromOffsetDays + index
    )
  );

  expect(new Set(allocatedOffsets).size).toBe(allocatedOffsets.length);
  expect(allocatedOffsets.toSorted((left, right) => left - right)).toEqual(
    Array.from(
      {
        length:
          workspaceE2EFullDateAllocation.toOffsetDays -
          workspaceE2EFullDateAllocation.fromOffsetDays +
          1,
      },
      (_, index) => workspaceE2EFullDateAllocation.fromOffsetDays + index
    )
  );
  expect(
    makeWorkspaceE2EDateAllocation({ prNumber: 2, runId: "ignored" })
  ).toEqual(
    makeWorkspaceE2EDateAllocation({ prNumber: 2, runId: "also-ignored" })
  );
});

test("uses the run identity deterministically when no PR number is available", () => {
  expect(makeWorkspaceE2EDateAllocation({ runId: "manual-run" })).toEqual(
    makeWorkspaceE2EDateAllocation({ runId: "manual-run" })
  );
});
