const { appendFileSync } = require("node:fs");

const allocatorAnchorSha = "7ff11c3b550458a2036f87cdf6ef912b00fad760";
const allocatorRef = "tags/workspace-e2e-allocation-registry";
const allocatorStatePrefix = "Workspace E2E allocation state v1\n\n";
const supportedConcurrency = 3;

const emptyAllocationState = () => ({
  queue: [],
  slots: Array.from({ length: supportedConcurrency }, () => null),
  version: 1,
});

const ownerKey = ({ runAttempt, runId }) => `${runId}:${runAttempt}`;

const compareOwners = (left, right) =>
  left.runId - right.runId || left.runAttempt - right.runAttempt;

const isOwner = (value) =>
  value !== null &&
  typeof value === "object" &&
  Number.isSafeInteger(value.runId) &&
  value.runId > 0 &&
  Number.isSafeInteger(value.runAttempt) &&
  value.runAttempt > 0 &&
  Number.isSafeInteger(value.preferredShard) &&
  value.preferredShard >= 0 &&
  value.preferredShard < supportedConcurrency;

const parseAllocationState = (message, tipSha) => {
  if (tipSha === allocatorAnchorSha) return emptyAllocationState();
  if (!message.startsWith(allocatorStatePrefix)) {
    throw new Error("Workspace E2E allocation registry has an invalid commit");
  }

  const state = JSON.parse(message.slice(allocatorStatePrefix.length));
  if (
    state?.version !== 1 ||
    !Array.isArray(state.slots) ||
    state.slots.length !== supportedConcurrency ||
    !state.slots.every((owner) => owner === null || isOwner(owner)) ||
    !Array.isArray(state.queue) ||
    !state.queue.every(isOwner)
  ) {
    throw new Error("Workspace E2E allocation registry has invalid state");
  }
  return state;
};

const transitionAllocationState = ({ activeOwnerKeys, mode, owner, state }) => {
  const self = ownerKey(owner);
  const seen = new Set();
  const slots = state.slots.map((entry) => {
    if (!entry || !activeOwnerKeys.has(ownerKey(entry))) return null;
    const key = ownerKey(entry);
    if (seen.has(key)) return null;
    seen.add(key);
    return entry;
  });
  const queue = state.queue
    .filter((entry) => activeOwnerKeys.has(ownerKey(entry)))
    .filter((entry) => {
      const key = ownerKey(entry);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  if (mode === "release") {
    for (let index = 0; index < slots.length; index += 1) {
      if (slots[index] && ownerKey(slots[index]) === self) slots[index] = null;
    }
    const queuedIndex = queue.findIndex((entry) => ownerKey(entry) === self);
    if (queuedIndex >= 0) queue.splice(queuedIndex, 1);
  } else if (
    !slots.some((entry) => entry && ownerKey(entry) === self) &&
    !queue.some((entry) => ownerKey(entry) === self)
  ) {
    queue.push(owner);
  }

  queue.sort(compareOwners);
  for (let queueIndex = 0; queueIndex < queue.length; ) {
    const entry = queue[queueIndex];
    let allocated = false;
    for (let offset = 0; offset < supportedConcurrency; offset += 1) {
      const shard = (entry.preferredShard + offset) % supportedConcurrency;
      if (slots[shard] === null) {
        slots[shard] = entry;
        queue.splice(queueIndex, 1);
        allocated = true;
        break;
      }
    }
    if (!allocated) break;
  }

  return { queue, slots, version: 1 };
};

const getOwnerShard = (state, owner) => {
  const key = ownerKey(owner);
  const index = state.slots.findIndex(
    (entry) => entry && ownerKey(entry) === key
  );
  return index < 0 ? undefined : index + 1;
};

const makeGitHubClient = ({ apiUrl, repository, token }) => {
  const request = async (path, options = {}) => {
    const response = await fetch(`${apiUrl}/repos/${repository}${path}`, {
      ...options,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...options.headers,
      },
    });
    const body = response.status === 204 ? undefined : await response.json();
    if (!response.ok) {
      const error = new Error(
        `GitHub allocation request failed with status ${response.status}`
      );
      error.status = response.status;
      throw error;
    }
    return body;
  };

  return {
    createCommit: ({ message, parent, tree }) =>
      request("/git/commits", {
        body: JSON.stringify({ message, parents: [parent], tree }),
        method: "POST",
      }),
    createRef: () =>
      request("/git/refs", {
        body: JSON.stringify({
          ref: `refs/${allocatorRef}`,
          sha: allocatorAnchorSha,
        }),
        method: "POST",
      }),
    getCommit: (sha) => request(`/git/commits/${sha}`),
    getRef: () => request(`/git/ref/${allocatorRef}`),
    getWorkflowRun: (runId) => request(`/actions/runs/${runId}`),
    updateRef: (sha) =>
      request(`/git/refs/${allocatorRef}`, {
        body: JSON.stringify({ force: false, sha }),
        method: "PATCH",
      }),
  };
};

const getRegistry = async (github) => {
  try {
    return await github.getRef();
  } catch (error) {
    if (error.status !== 404) throw error;
    try {
      return await github.createRef();
    } catch (createError) {
      if (createError.status !== 422) throw createError;
      return github.getRef();
    }
  }
};

const getActiveOwnerKeys = async (github, state) => {
  const owners = [...state.slots, ...state.queue].filter(Boolean);
  const uniqueOwners = [
    ...new Map(owners.map((owner) => [ownerKey(owner), owner])).values(),
  ];
  const active = await Promise.all(
    uniqueOwners.map(async (owner) => {
      try {
        const run = await github.getWorkflowRun(owner.runId);
        return run.status !== "completed" &&
          Number(run.run_attempt) === owner.runAttempt
          ? ownerKey(owner)
          : undefined;
      } catch (error) {
        if (error.status === 404) return undefined;
        throw error;
      }
    })
  );
  return new Set(active.filter(Boolean));
};

const updateAllocation = async ({ github, mode, owner }) => {
  for (;;) {
    const registry = await getRegistry(github);
    const tipSha = registry.object.sha;
    const tip = await github.getCommit(tipSha);
    const state = parseAllocationState(tip.message, tipSha);
    const activeOwnerKeys = await getActiveOwnerKeys(github, state);
    activeOwnerKeys.add(ownerKey(owner));
    const nextState = transitionAllocationState({
      activeOwnerKeys,
      mode,
      owner,
      state,
    });

    if (JSON.stringify(nextState) === JSON.stringify(state)) return nextState;

    const commit = await github.createCommit({
      message: `${allocatorStatePrefix}${JSON.stringify(nextState)}`,
      parent: tipSha,
      tree: tip.tree.sha,
    });
    try {
      await github.updateRef(commit.sha);
      return nextState;
    } catch (error) {
      if (error.status !== 409 && error.status !== 422) throw error;
    }
  }
};

const parsePositiveInteger = (name, value) => {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
};

const run = async (environment = process.env) => {
  const mode = environment.WORKSPACE_E2E_ALLOCATION_MODE;
  if (mode !== "acquire" && mode !== "release") {
    throw new Error("Workspace E2E allocation mode must be acquire or release");
  }
  const preferredShard = parsePositiveInteger(
    "Preferred shard",
    environment.WORKSPACE_E2E_ALLOCATION_PREFERRED_SHARD
  );
  if (preferredShard > supportedConcurrency) {
    throw new Error(`Preferred shard must be at most ${supportedConcurrency}`);
  }
  const owner = {
    preferredShard: preferredShard - 1,
    runAttempt: parsePositiveInteger(
      "GitHub run attempt",
      environment.GITHUB_RUN_ATTEMPT
    ),
    runId: parsePositiveInteger("GitHub run ID", environment.GITHUB_RUN_ID),
  };
  const github = makeGitHubClient({
    apiUrl: environment.GITHUB_API_URL,
    repository: environment.GITHUB_REPOSITORY,
    token: environment.WORKSPACE_E2E_ALLOCATION_TOKEN,
  });
  const waitSeconds = parsePositiveInteger(
    "Allocation wait seconds",
    environment.WORKSPACE_E2E_ALLOCATION_WAIT_SECONDS
  );
  const deadline = Date.now() + waitSeconds * 1000;

  for (;;) {
    const state = await updateAllocation({ github, mode, owner });
    if (mode === "release") return;
    const shard = getOwnerShard(state, owner);
    if (shard !== undefined) {
      appendFileSync(environment.GITHUB_OUTPUT, `shard=${shard}\n`);
      process.stdout.write(
        `Workspace E2E allocation acquired shard ${shard} of ${supportedConcurrency}\n`
      );
      return;
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `Workspace E2E allocation exhausted: all ${supportedConcurrency} shards remained leased for supported concurrency ${supportedConcurrency}`
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 10_000));
  }
};

if (require.main === module) {
  run().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : error}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  emptyAllocationState,
  getOwnerShard,
  ownerKey,
  parseAllocationState,
  transitionAllocationState,
  updateAllocation,
};
