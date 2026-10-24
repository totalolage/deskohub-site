import { afterAll, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { findStepByName, parseWorkflow } from "./shared/workflow-contract";
import {
  createWorkflowStepRunner,
  type GhFixtures,
  workflowStepRepository as repository,
  workflowStepRunId,
} from "./shared/workflow-step-runner";

const workflow = parseWorkflow(
  resolve(import.meta.dir, "../../../.github/workflows/workspace-e2e.yml")
);
const testJob = workflow.jobs["test-e2e"];
const guardJob = workflow.jobs["cancel-superseded-run"];
const headCheckStep = findStepByName(
  workflow,
  "Stop unless this SHA is still the PR head"
);
const leaseStep = findStepByName(workflow, "Lease an available date shard");
const leasedHeadCheckStep = findStepByName(
  workflow,
  "Release the lease unless this SHA is still the PR head"
);
const releaseStep = findStepByName(workflow, "Release date shard");
const guardStep = findStepByName(
  workflow,
  "Cancel this run once a newer PR head supersedes it"
);
const finalStep = findStepByName(workflow, "Publish final commit status");
const supersededDescription = String(finalStep?.env?.SUPERSEDED_DESCRIPTION);

const { cleanup, runStep } = createWorkflowStepRunner(
  "workspace-e2e-superseded-"
);
afterAll(cleanup);

// Run A resolved shaA while it was the head of PR #7, then stalled. shaB was
// pushed, deployed, and its run entered test-e2e before run A got there.
const prNumber = "7";
const shaA = "a".repeat(40);
const shaB = "b".repeat(40);
const headIsB = { [`pulls/${prNumber}`]: { head: { sha: shaB } } };
const ownCancel = `actions/runs/${workflowStepRunId}/cancel`;
const testJobCompleted = {
  [`actions/runs/${workflowStepRunId}/attempts/1/jobs`]: {
    jobs: [{ name: "test-e2e", status: "completed" }],
  },
};

const renderGroup = (sha: string) =>
  String(testJob?.concurrency?.group).replaceAll(
    /\$\{\{ needs\.resolve-target\.outputs\.(\w+) \}\}/g,
    (_, output: string) =>
      ({ pr_number: prNumber, sha })[output] ?? `<${output}>`
  );

const checkHead = (targetSha: string) =>
  runStep(headCheckStep, headIsB, {
    CANCEL_WAIT_SECONDS: "0",
    TARGET_SHA: targetSha,
    WORKSPACE_E2E_PR_NUMBER: prNumber,
  });

const checkLeasedHead = (targetSha: string) =>
  runStep(leasedHeadCheckStep, headIsB, {
    TARGET_SHA: targetSha,
    WORKSPACE_E2E_PR_NUMBER: prNumber,
  });

const testStepIndex = (name: string) =>
  (testJob?.steps ?? []).findIndex((step) => step.name === name);

const guard = (targetSha: string, fixtures: GhFixtures = headIsB) =>
  runStep(
    guardStep,
    { ...fixtures, ...testJobCompleted, [ownCancel]: {} },
    { POLL_SECONDS: "0", PR_NUMBER: prNumber, TARGET_SHA: targetSha }
  );

const publishFinal = (targetSha: string, state: "failure" | "success") =>
  runStep(
    finalStep,
    { ...headIsB, [`statuses/${shaA}`]: {}, [`statuses/${shaB}`]: {} },
    {
      ALLOCATION_DESCRIPTION: "Workspace E2E shard allocation failed",
      ALLOCATION_SHARD: "",
      PR_NUMBER: prNumber,
      STATUS_STATE: state,
      TARGET_SHA: targetSha,
    }
  );

const statusPosts = (calls: readonly string[]) =>
  calls.filter((call) => call.includes("/statuses/"));

describe("Workspace E2E run superseded before its test job", () => {
  test("puts runs for different heads of a PR in different concurrency groups", () => {
    expect(testJob?.concurrency?.["cancel-in-progress"]).toBe(true);
    expect(renderGroup(shaA)).toBe(`workspace-e2e-pr-${prNumber}-${shaA}`);
    // Run A entering test-e2e after run B can't cancel B, whatever the order.
    expect(renderGroup(shaA)).not.toBe(renderGroup(shaB));
  });

  test("stops run A at the start of its test job before it touches shared state", async () => {
    const { calls, result } = await checkHead(shaA);
    expect(result.exitCode).not.toBe(0);
    expect(calls).toEqual([expect.stringContaining(`pulls/${prNumber}`)]);
    expect(
      (testJob?.steps ?? []).findIndex((step) => step === headCheckStep)
    ).toBe(0);
  });

  test("lets run B, the current head, through", async () => {
    const { calls, result } = await checkHead(shaB);
    expect(result.exitCode).toBe(0);
    expect(calls).toHaveLength(1);
  });

  test("has run A cancel only its own run", async () => {
    const { calls, result } = await guard(shaA);
    expect(result.exitCode).toBe(0);
    const cancels = calls.filter((call) => call.includes("/cancel"));
    expect(cancels).toEqual([
      expect.stringContaining(`repos/${repository}/${ownCancel}`),
    ]);
    expect(cancels[0]).toContain("--method POST");
  });

  test("leaves run B running until its test job completes", async () => {
    const { calls, result } = await guard(shaB);
    expect(result.exitCode).toBe(0);
    expect(calls.some((call) => call.includes("/cancel"))).toBe(false);
  });

  test("never cancels on a failed head lookup", async () => {
    const { calls, result } = await guard(shaA, {});
    expect(result.exitCode).toBe(0);
    expect(calls.some((call) => call.includes("/cancel"))).toBe(false);
  });

  test("publishes run A's stop only to its own SHA, as superseded", async () => {
    const { calls, result } = await publishFinal(shaA, "failure");
    expect(result.exitCode).toBe(0);
    const posts = statusPosts(calls);
    expect(posts).toHaveLength(2);
    for (const post of posts) {
      expect(post).toContain(`statuses/${shaA}`);
      expect(post).toContain("state=failure");
      expect(post).toContain(`description=${supersededDescription}`);
    }
  });

  test("keeps a pass that finished before the head moved", async () => {
    const { calls } = await publishFinal(shaA, "success");
    const [e2e] = statusPosts(calls);
    expect(e2e).toContain("description=Protected preview E2E passed");
    expect(calls.some((call) => call.includes(`pulls/${prNumber}`))).toBe(
      false
    );
  });

  test("reports a current head's failure as a failed run", async () => {
    const { calls } = await publishFinal(shaB, "failure");
    const [e2e, allocation] = statusPosts(calls);
    expect(e2e).toContain(`statuses/${shaB}`);
    expect(e2e).toContain("description=Protected preview E2E failed");
    expect(allocation).toContain(
      "description=Workspace E2E shard allocation failed"
    );
  });

  test("runs the cancelling guard beside test-e2e without exact-SHA code", () => {
    expect(guardJob?.needs).toBe("resolve-target");
    // A nightly target has no PR head to supersede.
    expect(guardJob?.if).toBe(
      `${testJob?.if} && needs.resolve-target.outputs.nightly != 'true'`
    );
    expect(guardJob?.permissions).toEqual({
      actions: "write",
      "pull-requests": "read",
    });
    expect(guardJob?.steps?.every((step) => step.uses === undefined)).toBe(
      true
    );
    // The guard stops once this job id reports completed.
    expect(guardStep?.run).toContain('select(.name == "test-e2e")');
    expect(testJob?.name).toBeUndefined();
    expect(testJob?.permissions?.actions).toBe("read");
  });
});

// Run A passed its start check while shaA was the head, so cancellation, not
// the start check, has to stop it, and cancellation is asynchronous. Run B
// for shaB must not touch the preview database while A still runs.
describe("Workspace E2E runs sharing a preview database", () => {
  test("leases the branch's preview database before the migration and frees it last", () => {
    expect(String(leaseStep?.with?.["preview-branch"])).toContain(
      "needs.resolve-target.outputs.head_ref"
    );
    const leaseIndex = testStepIndex("Lease an available date shard");
    expect(leaseIndex).toBeGreaterThan(0);
    expect(leaseIndex).toBeLessThan(
      testStepIndex("Resolve Neon branch backing the preview")
    );
    expect(leaseIndex).toBeLessThan(testStepIndex("Migrate preview database"));
    // The release runs after a cancellation too, and after every step that
    // touches the database.
    expect(releaseStep?.if).toBe("always() && steps.lease.outputs.shard != ''");
    expect(testJob?.steps?.at(-1)).toBe(releaseStep);
  });

  test("fails run A at once when it got the lease after the head moved", async () => {
    const { calls, result } = await checkLeasedHead(shaA);
    expect(result.exitCode).not.toBe(0);
    expect(calls).toEqual([expect.stringContaining(`pulls/${prNumber}`)]);
    const index = testStepIndex(
      "Release the lease unless this SHA is still the PR head"
    );
    expect(index).toBe(testStepIndex("Lease an available date shard") + 1);
    expect(leasedHeadCheckStep?.if).toBe(
      "needs.resolve-target.outputs.nightly != 'true'"
    );
  });

  test("lets run B use the database once it holds the lease", async () => {
    const { calls, result } = await checkLeasedHead(shaB);
    expect(result.exitCode).toBe(0);
    expect(calls).toHaveLength(1);
  });
});
