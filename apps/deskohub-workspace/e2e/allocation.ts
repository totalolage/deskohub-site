export const workspaceE2EConcurrentRunTarget = 3;
export const workspaceE2EProviderHeadroomRuns = 1;

export type WorkspaceE2EDateAllocation = {
  readonly fromOffsetDays: number;
  readonly shardCount: number;
  readonly shardIndex: number;
  readonly toOffsetDays: number;
};

export const workspaceE2EFullDateAllocation: WorkspaceE2EDateAllocation = {
  fromOffsetDays: 14,
  shardCount: 1,
  shardIndex: 0,
  toOffsetDays: 90,
};

export const makeWorkspaceE2EDateAllocation = ({
  prNumber,
  runId,
}: {
  readonly prNumber?: number;
  readonly runId: string;
}): WorkspaceE2EDateAllocation => {
  const shardCount = workspaceE2EConcurrentRunTarget;
  const allocationKey = prNumber ?? hashAllocationKey(runId);
  const shardIndex = Math.abs(allocationKey) % shardCount;
  const candidateCount =
    workspaceE2EFullDateAllocation.toOffsetDays -
    workspaceE2EFullDateAllocation.fromOffsetDays +
    1;
  const minimumShardSize = Math.floor(candidateCount / shardCount);
  const largerShardCount = candidateCount % shardCount;
  const shardSize = minimumShardSize + (shardIndex < largerShardCount ? 1 : 0);
  const precedingLargerShards = Math.min(shardIndex, largerShardCount);
  const fromOffsetDays =
    workspaceE2EFullDateAllocation.fromOffsetDays +
    shardIndex * minimumShardSize +
    precedingLargerShards;

  return {
    fromOffsetDays,
    shardCount,
    shardIndex,
    toOffsetDays: fromOffsetDays + shardSize - 1,
  };
};

export const formatWorkspaceE2EAllocation = (
  allocation: WorkspaceE2EDateAllocation
) => `shard ${allocation.shardIndex + 1} of ${allocation.shardCount}`;

const hashAllocationKey = (value: string) => {
  let hash = 2_166_136_261;

  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16_777_619);
  }

  return hash >>> 0;
};
