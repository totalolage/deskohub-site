import { expect, test } from "bun:test";
import {
  isWorkspaceE2EAllocatedWeekday,
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
  const candidateDates = Array.from(
    {
      length:
        workspaceE2EFullDateAllocation.toOffsetDays -
        workspaceE2EFullDateAllocation.fromOffsetDays +
        1,
    },
    (_, index) => {
      const date = new Date("2099-07-17T00:00:00.000Z");
      date.setUTCDate(
        date.getUTCDate() +
          workspaceE2EFullDateAllocation.fromOffsetDays +
          index
      );
      return date.toISOString().slice(0, 10);
    }
  );
  const allocatedDates = allocations.flatMap((allocation) =>
    candidateDates.filter((date) =>
      isWorkspaceE2EAllocatedWeekday(date, allocation)
    )
  );
  const weekdays = candidateDates.filter((date) => {
    const day = new Date(`${date}T00:00:00.000Z`).getUTCDay();
    return day !== 0 && day !== 6;
  });

  expect(new Set(allocatedDates).size).toBe(allocatedDates.length);
  expect(allocatedDates.toSorted()).toEqual(weekdays);
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

test("uses coordinated leases to separate colliding PR identities", () => {
  const first = makeWorkspaceE2EDateAllocation({
    prNumber: 100,
    runId: "first-run",
    shardIndex: 0,
  });
  const second = makeWorkspaceE2EDateAllocation({
    prNumber: 103,
    runId: "second-run",
    shardIndex: 1,
  });

  expect(first.shardIndex).not.toBe(second.shardIndex);
  const candidates = [
    "2099-07-31",
    "2099-08-03",
    "2099-08-04",
    "2099-08-05",
    "2099-08-06",
    "2099-08-07",
  ];
  const firstCandidates = candidates.filter((date) =>
    isWorkspaceE2EAllocatedWeekday(date, first)
  );
  const secondCandidates = candidates.filter((date) =>
    isWorkspaceE2EAllocatedWeekday(date, second)
  );
  expect(
    firstCandidates.some((candidate) => secondCandidates.includes(candidate))
  ).toBe(false);
});
