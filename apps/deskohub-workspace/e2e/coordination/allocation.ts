import { Schema } from "effect";

export const allocationPoolName = "dotypos-sandbox";
export const supportedAllocationConcurrency = 3;

const positiveInteger = Schema.Int.check(Schema.isGreaterThan(0));
const allocationShard = positiveInteger.check(
  Schema.isLessThanOrEqualTo(supportedAllocationConcurrency)
);

export const AllocationOwner = Schema.Struct({
  repository: Schema.NonEmptyString,
  runAttempt: positiveInteger,
  runId: positiveInteger,
});

export type AllocationOwner = typeof AllocationOwner.Type;

export const AllocationRequest = Schema.Struct({
  ...AllocationOwner.fields,
  allocatedShard: Schema.NullOr(allocationShard),
  preferredShard: allocationShard,
  // Every SHA of a PR shares the Neon database of its branch's preview, so
  // an allocation also holds that branch exclusively. Null only for requests
  // from an allocator that predates this.
  previewBranch: Schema.NullOr(Schema.NonEmptyString),
  queuePosition: positiveInteger,
});

export type AllocationRequest = typeof AllocationRequest.Type;

export interface AllocationAssignment {
  readonly owner: AllocationOwner;
  readonly shard: number;
}

export const allocationOwnerKey = (owner: AllocationOwner) =>
  `${owner.repository}:${owner.runId}:${owner.runAttempt}`;

export const assignQueuedAllocationRequests = ({
  requests,
  shardCount,
}: {
  readonly requests: readonly AllocationRequest[];
  readonly shardCount: number;
}): readonly AllocationAssignment[] => {
  const allocated = requests.filter(
    ({ allocatedShard }) => allocatedShard !== null
  );
  const occupiedShards = new Set(
    allocated.map(({ allocatedShard }) => allocatedShard)
  );
  const occupiedPreviewBranches = new Set(
    allocated.map(({ previewBranch }) => previewBranch)
  );
  const assignments: AllocationAssignment[] = [];

  for (const request of requests
    .filter(({ allocatedShard }) => allocatedShard === null)
    .toSorted((left, right) => left.queuePosition - right.queuePosition)) {
    // A request waiting for its preview branch keeps its ticket without
    // holding back requests for other branches.
    const { previewBranch } = request;
    if (previewBranch !== null && occupiedPreviewBranches.has(previewBranch)) {
      continue;
    }

    for (let offset = 0; offset < shardCount; offset += 1) {
      const shard = ((request.preferredShard - 1 + offset) % shardCount) + 1;
      if (occupiedShards.has(shard)) continue;

      occupiedShards.add(shard);
      occupiedPreviewBranches.add(previewBranch);
      assignments.push({ owner: request, shard });
      break;
    }
  }

  return assignments;
};
