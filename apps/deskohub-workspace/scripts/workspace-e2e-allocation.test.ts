import { expect, test } from "bun:test";
import {
  type AllocationRequest,
  assignQueuedAllocationRequests,
} from "../e2e/coordination/allocation";

const request = ({
  allocatedShard = null,
  preferredShard = 1,
  queuePosition,
  runId,
}: {
  readonly allocatedShard?: number | null;
  readonly preferredShard?: number;
  readonly queuePosition: number;
  readonly runId: number;
}): AllocationRequest => ({
  allocatedShard,
  preferredShard,
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
