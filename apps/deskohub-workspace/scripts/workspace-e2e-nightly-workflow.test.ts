import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { findStepByName, parseWorkflow } from "./shared/workflow-contract";
import {
  createWorkflowStepRunner,
  type GhFixtures,
  workflowStepRepository as repository,
} from "./shared/workflow-step-runner";

const workflowsDir = resolve(import.meta.dir, "../../../.github/workflows");
const nightly = parseWorkflow(resolve(workflowsDir, "workspace-e2e-nightly.yml"));
const e2e = parseWorkflow(resolve(workflowsDir, "workspace-e2e.yml"));
const nightlyTriggers = (
  Bun.YAML.parse(
    readFileSync(resolve(workflowsDir, "workspace-e2e-nightly.yml"), "utf8")
  ) as { readonly on: Record<string, unknown> }
).on;

const targetStep = findStepByName(
  nightly,
  "Point the nightly branch at main and wait for its preview"
);
const dispatchStep = findStepByName(
  nightly,
  "Dispatch Workspace E2E with nightly cases"
);
const nightlyBranch = String(targetStep?.env?.NIGHTLY_BRANCH);

const sha = (digit: string) => digit.repeat(40);
const mainSha = sha("a");
const olderMainSha = sha("b");
const previewUrl = "https://deskohub-workspace-site-abc123-team.vercel.app";

const succeeded = [
  {
    description: "Deployment has completed",
    environment_url: `${previewUrl}/`,
    state: "success",
  },
];
const skipped = [{ description: "Skipped - Not affected", state: "inactive" }];
const failed = [{ description: "Build failed", state: "failure" }];

const { cleanup, runStep } = createWorkflowStepRunner("workspace-e2e-nightly-");
afterAll(cleanup);

const prepareTarget = (
  fixtures: GhFixtures,
  env: Readonly<Record<string, string>> = {}
) =>
  runStep(
    targetStep,
    {
      "commits/main": { sha: mainSha },
      "git/refs": {},
      [`git/refs/heads/${nightlyBranch}`]: {},
      ...fixtures,
    },
    { DEPLOYMENT_WAIT_SECONDS: "60", POLL_SECONDS: "0", ...env }
  );

const deploymentOf = (commit: string, id: number, statuses: object[]) => ({
  [`deployments@sha=${commit}`]: [{ creator: { login: "vercel[bot]" }, id }],
  [`deployments/${id}/statuses`]: statuses,
});

const nightlyHead = (commit: string) => ({
  [`git/ref/heads/${nightlyBranch}`]: { object: { sha: commit } },
});

const branchMoves = (calls: readonly string[]) =>
  calls.filter(
    (call) =>
      call.includes(`repos/${repository}/git/refs`) &&
      (call.includes("--method POST") || call.includes("--method PATCH"))
  );

describe("Workspace E2E nightly target", () => {
  test("reuses main's preview when the nightly branch already has it", async () => {
    const { calls, outputs, result } = await prepareTarget({
      ...nightlyHead(mainSha),
      ...deploymentOf(mainSha, 1, succeeded),
    });
    expect(result.exitCode).toBe(0);
    expect(outputs).toEqual({ sha: mainSha, url: previewUrl });
    expect(branchMoves(calls)).toEqual([]);
  });

  test("moves the nightly branch to main's head and waits for its preview", async () => {
    const { calls, outputs, result } = await prepareTarget({
      ...nightlyHead(olderMainSha),
      ...deploymentOf(mainSha, 1, succeeded),
    });
    expect(result.exitCode).toBe(0);
    expect(outputs).toEqual({ sha: mainSha, url: previewUrl });
    const [move, ...rest] = branchMoves(calls);
    expect(rest).toEqual([]);
    expect(move).toContain("--method PATCH");
    expect(move).toContain(`git/refs/heads/${nightlyBranch}`);
    expect(move).toContain(`sha=${mainSha}`);
  });

  test("creates the nightly branch on the first run", async () => {
    const { calls, result } = await prepareTarget(
      deploymentOf(mainSha, 1, succeeded)
    );
    expect(result.exitCode).toBe(0);
    const [create, ...rest] = branchMoves(calls);
    expect(rest).toEqual([]);
    expect(create).toContain("--method POST");
    expect(create).toContain(`ref=refs/heads/${nightlyBranch}`);
    expect(create).toContain(`sha=${mainSha}`);
  });

  test("fails when Vercel skipped main's head instead of testing another commit", async () => {
    const { calls, outputs, result } = await prepareTarget({
      ...nightlyHead(mainSha),
      ...deploymentOf(mainSha, 1, skipped),
    });
    expect(result.exitCode).not.toBe(0);
    expect(outputs).toEqual({});
    expect(branchMoves(calls)).toEqual([]);
  });

  test("fails a failed preview", async () => {
    const { outputs, result } = await prepareTarget({
      ...nightlyHead(mainSha),
      ...deploymentOf(mainSha, 1, failed),
    });
    expect(result.exitCode).not.toBe(0);
    expect(outputs).toEqual({});
  });

  test("fails when Vercel builds no preview in time", async () => {
    const { outputs, result } = await prepareTarget(
      { ...nightlyHead(mainSha), [`deployments@sha=${mainSha}`]: [] },
      { DEPLOYMENT_WAIT_SECONDS: "0" }
    );
    expect(result.exitCode).not.toBe(0);
    expect(outputs).toEqual({});
  });

  test("dispatches Workspace E2E for the target with the nightly cases", async () => {
    const { calls, result } = await runStep(
      dispatchStep,
      { "": {} },
      {
        GITHUB_REF_NAME: "main",
        TARGET_SHA: mainSha,
        TARGET_URL: previewUrl,
      }
    );
    expect(result.exitCode).toBe(0);
    expect(calls).toHaveLength(1);
    const [dispatch = ""] = calls;
    expect(dispatch).toStartWith("workflow run workspace-e2e.yml");
    for (const field of [
      `sha=${mainSha}`,
      `url=${previewUrl}`,
      `ref=${nightlyBranch}`,
      "include_nightly_cases=true",
    ]) {
      expect(dispatch).toContain(field);
    }
  });
});

describe("Workspace E2E nightly workflow contract", () => {
  test("runs on a schedule and on demand, one run at a time", () => {
    expect(Object.keys(nightlyTriggers).sort()).toEqual([
      "schedule",
      "workflow_dispatch",
    ]);
    expect(nightly.concurrency).toMatchObject({ "cancel-in-progress": false });
  });

  test("holds write access only in a job that runs no repository code", () => {
    expect(nightly.permissions).toEqual({});
    const jobs = Object.values(nightly.jobs);
    expect(jobs).toHaveLength(1);
    const [job] = jobs;
    expect(job?.permissions).toEqual({
      actions: "write",
      contents: "write",
      deployments: "read",
    });
    expect(job?.steps?.every((step) => step.uses === undefined)).toBe(true);
  });

  test("dispatches the branch the Workspace E2E workflow treats as nightly", () => {
    const resolution = findStepByName(
      e2e,
      "Resolve eligible PR and immutable preview"
    );
    expect(resolution?.env?.NIGHTLY_BRANCH).toBe(nightlyBranch);
    expect(dispatchStep?.run).toContain("ref=e2e/nightly");
    expect(nightlyBranch).toBe("e2e/nightly");
  });

  test("runs nightly cases only when a dispatch opts in", () => {
    expect(
      findStepByName(e2e, "Run checkout E2E")?.env?.WORKSPACE_E2E_NIGHTLY_CASES
    ).toBe(
      "${{ github.event_name == 'workflow_dispatch' && inputs.include_nightly_cases && 'true' || '' }}"
    );
  });
});
