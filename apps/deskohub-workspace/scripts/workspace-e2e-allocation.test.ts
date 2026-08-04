import { expect, test } from "bun:test";
import { resolve } from "node:path";

const allocator = require(
  resolve(
    import.meta.dir,
    "../../../.github/actions/workspace-e2e-allocation/index.cjs"
  )
) as {
  emptyAllocationState: () => AllocationState;
  getOwnerShard: (state: AllocationState, owner: Owner) => number | undefined;
  ownerKey: (owner: Owner) => string;
  transitionAllocationState: (input: {
    activeOwnerKeys: ReadonlySet<string>;
    mode: "acquire" | "release";
    owner: Owner;
    state: AllocationState;
  }) => AllocationState;
  updateAllocation: (input: {
    github: AllocationGitHub;
    mode: "acquire" | "release";
    owner: Owner;
  }) => Promise<AllocationState>;
};

type Owner = {
  readonly preferredShard: number;
  readonly runAttempt: number;
  readonly runId: number;
};

type AllocationState = {
  readonly queue: readonly Owner[];
  readonly slots: readonly (Owner | null)[];
  readonly version: 1;
};

type AllocationGitHub = {
  createCommit: (input: {
    message: string;
    parent: string;
    tree: string;
  }) => Promise<{ sha: string }>;
  createRef: () => Promise<{ object: { sha: string } }>;
  getCommit: (
    sha: string
  ) => Promise<{ message: string; tree: { sha: string } }>;
  getRef: () => Promise<{ object: { sha: string } }>;
  getWorkflowRun: (
    runId: number
  ) => Promise<{ run_attempt: number; status: string }>;
  updateRef: (sha: string) => Promise<void>;
};

const owners: readonly Owner[] = [
  { preferredShard: 0, runAttempt: 1, runId: 101 },
  { preferredShard: 0, runAttempt: 1, runId: 102 },
  { preferredShard: 0, runAttempt: 1, runId: 103 },
  { preferredShard: 0, runAttempt: 1, runId: 104 },
];

test("allocates three same-preference contenders and preserves the fourth", () => {
  let state = allocator.emptyAllocationState();
  const activeOwnerKeys = new Set(owners.map(allocator.ownerKey));

  for (const owner of owners) {
    state = allocator.transitionAllocationState({
      activeOwnerKeys,
      mode: "acquire",
      owner,
      state,
    });
  }

  expect(state.slots.map((owner) => owner?.runId)).toEqual([101, 102, 103]);
  expect(state.queue.map(({ runId }) => runId)).toEqual([104]);
  expect(
    new Set(state.slots.filter(Boolean).map(allocator.ownerKey)).size
  ).toBe(3);
});

test("owner-checked release advances the queue without disturbing siblings", () => {
  const activeOwnerKeys = new Set(owners.map(allocator.ownerKey));
  let state = allocator.emptyAllocationState();
  for (const owner of owners) {
    state = allocator.transitionAllocationState({
      activeOwnerKeys,
      mode: "acquire",
      owner,
      state,
    });
  }

  state = allocator.transitionAllocationState({
    activeOwnerKeys,
    mode: "release",
    owner: owners[1]!,
    state,
  });

  expect(state.slots.map((owner) => owner?.runId)).toEqual([101, 104, 103]);
  expect(state.queue).toEqual([]);
  expect(allocator.getOwnerShard(state, owners[3]!)).toBe(2);
});

test("reclaims only terminal owners and ignores a stale release", () => {
  const [terminal, active, stale] = owners;
  const state: AllocationState = {
    queue: [],
    slots: [terminal!, active!, null],
    version: 1,
  };
  const activeOwnerKeys = new Set([allocator.ownerKey(active!)]);

  const reclaimed = allocator.transitionAllocationState({
    activeOwnerKeys,
    mode: "release",
    owner: stale!,
    state,
  });

  expect(reclaimed.slots.map((owner) => owner?.runId)).toEqual([
    undefined,
    active!.runId,
    undefined,
  ]);
});

test("concurrent registry writers retry the losing non-fast-forward update", async () => {
  const anchor = "7ff11c3b550458a2036f87cdf6ef912b00fad760";
  let tip = anchor;
  let commitSequence = 0;
  let updateCalls = 0;
  let openBarrier = () => undefined;
  const barrier = new Promise<void>((resolve) => {
    openBarrier = resolve;
  });
  const commits = new Map([
    [anchor, { message: "anchor", parent: undefined, tree: { sha: "tree" } }],
  ]);
  const github: AllocationGitHub = {
    createCommit: async ({ message, parent, tree }) => {
      commitSequence += 1;
      const sha = `commit-${commitSequence}`;
      commits.set(sha, { message, parent, tree: { sha: tree } });
      return { sha };
    },
    createRef: async () => ({ object: { sha: tip } }),
    getCommit: async (sha) => {
      const commit = commits.get(sha);
      if (!commit) throw new Error(`Missing commit ${sha}`);
      return commit;
    },
    getRef: async () => ({ object: { sha: tip } }),
    getWorkflowRun: async () => ({ run_attempt: 1, status: "in_progress" }),
    updateRef: async (sha) => {
      updateCalls += 1;
      if (updateCalls === 2) openBarrier();
      if (updateCalls <= 2) await barrier;
      const commit = commits.get(sha);
      if (commit?.parent !== tip)
        throw Object.assign(new Error(), { status: 422 });
      tip = sha;
    },
  };

  await Promise.all(
    owners
      .slice(0, 2)
      .map((owner) =>
        allocator.updateAllocation({ github, mode: "acquire", owner })
      )
  );

  const finalCommit = await github.getCommit(tip);
  const finalState = JSON.parse(finalCommit.message.split("\n\n")[1]!);
  expect(finalState.slots.map((owner: Owner | null) => owner?.runId)).toEqual([
    101,
    102,
    undefined,
  ]);
  expect(updateCalls).toBe(3);
});
