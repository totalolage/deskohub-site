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

export const getWorkspaceE2ECandidateDate = (
  offsetDays: number,
  now = new Date()
) => {
  const date = new Date(now);
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
};

export const makeWorkspaceE2EDateAllocation = ({
  prNumber,
  runId,
  shardIndex: leasedShardIndex,
}: {
  readonly prNumber?: number;
  readonly runId: string;
  readonly shardIndex?: number;
}): WorkspaceE2EDateAllocation => {
  const shardCount = workspaceE2EConcurrentRunTarget;
  const allocationKey = prNumber ?? hashAllocationKey(runId);
  const shardIndex = leasedShardIndex ?? Math.abs(allocationKey) % shardCount;
  if (
    !Number.isSafeInteger(shardIndex) ||
    shardIndex < 0 ||
    shardIndex >= shardCount
  ) {
    throw new Error(
      `Workspace E2E allocation shard must be between 0 and ${shardCount - 1}`
    );
  }
  return {
    fromOffsetDays: workspaceE2EFullDateAllocation.fromOffsetDays,
    shardCount,
    shardIndex,
    toOffsetDays: workspaceE2EFullDateAllocation.toOffsetDays,
  };
};

export const isWorkspaceE2EAllocatedWeekday = (
  isoDate: string,
  allocation: WorkspaceE2EDateAllocation
) => {
  const millisecondsPerDay = 86_400_000;
  const mondayEpochDay = 4;
  const epochDay = Math.floor(
    Date.parse(`${isoDate}T00:00:00.000Z`) / millisecondsPerDay
  );
  const daysSinceMondayEpoch = epochDay - mondayEpochDay;
  const weekdayIndex = positiveModulo(daysSinceMondayEpoch, 7);
  if (weekdayIndex >= 5) return false;

  const weekdayOrdinal =
    Math.floor(daysSinceMondayEpoch / 7) * 5 + weekdayIndex;
  return (
    positiveModulo(weekdayOrdinal, allocation.shardCount) ===
    allocation.shardIndex
  );
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

const positiveModulo = (value: number, divisor: number) =>
  ((value % divisor) + divisor) % divisor;
