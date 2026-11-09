import { expect, test } from "bun:test";
import {
  type AllocationRequest,
  assignQueuedAllocationRequests,
} from "../e2e/coordination/allocation";

const request = ({
  allocatedShard = null,
  preferredShard = 1,
  previewBranch,
  queuePosition,
  runId,
}: {
  readonly allocatedShard?: number | null;
  readonly preferredShard?: number;
  readonly previewBranch?: string | null;
  readonly queuePosition: number;
  readonly runId: number;
}): AllocationRequest => ({
  allocatedShard,
  preferredShard,
  previewBranch:
    previewBranch === undefined ? `feature/run-${runId}` : previewBranch,
  queuePosition,
  repository: "totalolage/deskohub-site",
  runAttempt: 1,
  runId,
});

test("allocates three same-preference contenders and preserves the fourth", () => {
  const assignments = assignQueuedAllocationRequests({
    requests: [
      request({ queuePosition: 1, runId: 101 }),
      request({ queuePosition: 2, runId: 102 }),
      request({ queuePosition: 3, runId: 103 }),
      request({ queuePosition: 4, runId: 104 }),
    ],
    shardCount: 3,
  });

  expect(assignments.map(({ owner, shard }) => [owner.runId, shard])).toEqual([
    [101, 1],
    [102, 2],
    [103, 3],
  ]);
});

test("uses the persisted queue ticket instead of run identity for FIFO", () => {
  const assignments = assignQueuedAllocationRequests({
    requests: [
      request({ queuePosition: 20, runId: 100 }),
      request({ queuePosition: 10, runId: 999 }),
    ],
    shardCount: 3,
  });

  expect(assignments.map(({ owner }) => owner.runId)).toEqual([999, 100]);
});

test("advances the queue into a released shard without disturbing siblings", () => {
  const assignments = assignQueuedAllocationRequests({
    requests: [
      request({ allocatedShard: 1, queuePosition: 1, runId: 101 }),
      request({ allocatedShard: 3, queuePosition: 3, runId: 103 }),
      request({ queuePosition: 4, runId: 104 }),
    ],
    shardCount: 3,
  });

  expect(assignments).toEqual([
    {
      owner: request({ queuePosition: 4, runId: 104 }),
      shard: 2,
    },
  ]);
});

test("preserves each contender's preferred shard when choices do not collide", () => {
  const assignments = assignQueuedAllocationRequests({
    requests: [
      request({ preferredShard: 3, queuePosition: 1, runId: 101 }),
      request({ preferredShard: 1, queuePosition: 2, runId: 102 }),
      request({ preferredShard: 2, queuePosition: 3, runId: 103 }),
    ],
    shardCount: 3,
  });

  expect(assignments.map(({ shard }) => shard)).toEqual([3, 1, 2]);
});

// Every SHA of a PR shares its branch's preview database. Run 101 tested the
// old head of feature/a and is still running after its head check while its
// cancellation is pending; run 102 tested the new head.
test("holds a newer head's run until the older run of its preview branch releases", () => {
  const olderRunHolding = request({
    allocatedShard: 1,
    previewBranch: "feature/a",
    queuePosition: 1,
    runId: 101,
  });
  const newerRun = request({
    previewBranch: "feature/a",
    queuePosition: 2,
    runId: 102,
  });
  const otherPullRequest = request({ queuePosition: 3, runId: 103 });

  expect(
    assignQueuedAllocationRequests({
      requests: [olderRunHolding, newerRun, otherPullRequest],
      shardCount: 3,
    }).map(({ owner }) => owner.runId)
  ).toEqual([103]);

  expect(
    assignQueuedAllocationRequests({
      requests: [newerRun, otherPullRequest],
      shardCount: 3,
    }).map(({ owner }) => owner.runId)
  ).toEqual([102, 103]);
});

test("admits one waiting run per preview branch at a time", () => {
  const assignments = assignQueuedAllocationRequests({
    requests: [
      request({ previewBranch: "feature/a", queuePosition: 1, runId: 101 }),
      request({ previewBranch: "feature/a", queuePosition: 2, runId: 102 }),
    ],
    shardCount: 3,
  });

  expect(assignments.map(({ owner }) => owner.runId)).toEqual([101]);
});

test("never lets a late older run displace the newer run holding its preview branch", () => {
  const assignments = assignQueuedAllocationRequests({
    requests: [
      request({
        allocatedShard: 2,
        previewBranch: "feature/a",
        queuePosition: 5,
        runId: 202,
      }),
      request({ previewBranch: "feature/a", queuePosition: 6, runId: 201 }),
    ],
    shardCount: 3,
  });

  expect(assignments).toEqual([]);
});

test("does not hold requests from an allocator that predates preview branches", () => {
  const assignments = assignQueuedAllocationRequests({
    requests: [
      request({
        allocatedShard: 1,
        previewBranch: null,
        queuePosition: 1,
        runId: 101,
      }),
      request({ previewBranch: null, queuePosition: 2, runId: 102 }),
    ],
    shardCount: 3,
  });

  expect(assignments.map(({ owner }) => owner.runId)).toEqual([102]);
});
