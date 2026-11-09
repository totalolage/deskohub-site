import { afterAll, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { findStepByName, parseWorkflow } from "./shared/workflow-contract";
import {
  createWorkflowStepRunner,
  type GhFixtures,
  workflowStepRepository as repository,
} from "./shared/workflow-step-runner";

const workflowsDir = resolve(import.meta.dir, "../../../.github/workflows");
const nightly = parseWorkflow(
  resolve(workflowsDir, "workspace-e2e-nightly.yml")
);
const e2e = parseWorkflow(resolve(workflowsDir, "workspace-e2e.yml"));
const nightlyTriggers = nightly.on ?? {};

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
const mainParentSha = sha("d");
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
      "commits/main": { parents: [{ sha: mainParentSha }], sha: mainSha },
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

  // Vercel built nothing for the branch created at main's head, so the
  // first run creates it at main's parent and then moves it.
  test("creates the nightly branch behind main's head, then moves it there", async () => {
    const { calls, result } = await prepareTarget(
      deploymentOf(mainSha, 1, succeeded)
    );
    expect(result.exitCode).toBe(0);
    const [create, move, ...rest] = branchMoves(calls);
    expect(rest).toEqual([]);
    expect(create).toContain("--method POST");
    expect(create).toContain(`ref=refs/heads/${nightlyBranch}`);
    expect(create).toContain(`sha=${mainParentSha}`);
    expect(move).toContain("--method PATCH");
    expect(move).toContain(`git/refs/heads/${nightlyBranch}`);
    expect(move).toContain(`sha=${mainSha}`);
  });

  test("stops before moving the nightly branch when creating it fails", async () => {
    // No `git/refs` fixture, so the fake gh fails the creation.
    const { calls, outputs, result } = await runStep(
      targetStep,
      {
        "commits/main": { parents: [{ sha: mainParentSha }], sha: mainSha },
        [`git/refs/heads/${nightlyBranch}`]: {},
      },
      { DEPLOYMENT_WAIT_SECONDS: "0", POLL_SECONDS: "0" }
    );
    expect(result.exitCode).not.toBe(0);
    expect(outputs).toEqual({});
    const [create, ...rest] = branchMoves(calls);
    expect(create).toContain("--method POST");
    expect(rest).toEqual([]);
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

  test.each([
    ["after moving the nightly branch", olderMainSha, 1],
    ["for the nightly branch already at main's head", mainSha, 0],
  ])(
    "fails when Vercel builds no preview in time %s",
    async (_label, head, moves) => {
      const { calls, outputs, result } = await prepareTarget(
        { ...nightlyHead(head), [`deployments@sha=${mainSha}`]: [] },
        { DEPLOYMENT_WAIT_SECONDS: "0" }
      );
      expect(result.exitCode).not.toBe(0);
      expect(outputs).toEqual({});
      expect(branchMoves(calls)).toHaveLength(moves);
    }
  );

  test("dispatches Workspace E2E for the target with the nightly cases", async () => {
    const { calls, result } = await runStep(
      dispatchStep,
      { "": {} },
      {
        GITHUB_REF_NAME: "feature/x",
        TARGET_SHA: mainSha,
        TARGET_URL: previewUrl,
      }
    );
    expect(result.exitCode).toBe(0);
    expect(calls).toHaveLength(1);
    const [dispatch = ""] = calls;
    expect(dispatch).toStartWith("workflow run workspace-e2e.yml");
    for (const field of [
      "--ref main",
      `sha=${mainSha}`,
      `url=${previewUrl}`,
      `ref=${nightlyBranch}`,
      "include_nightly_cases=true",
    ]) {
      expect(dispatch).toContain(field);
    }
  });
});

const checkoutStep = findStepByName(e2e, "Run checkout E2E");
const vercelProject = "prj_workspace";

// Stand-ins for the Vercel API read and the suite: curl answers from the
// `vercel-deployment` fixture, and bun only records that the suite started.
const fakeCommands = {
  bun: `#!/usr/bin/env bash
printf 'bun %s\\n' "$*" >> "$GH_FIXTURES/calls.log"
`,
  curl: `#!/usr/bin/env bash
cat "$GH_FIXTURES/vercel-deployment.json"
`,
};

type VercelDeploymentFixture = {
  readonly meta: {
    readonly githubCommitRef: string;
    readonly githubCommitSha: string;
  };
  readonly projectId: string;
  readonly target: string | null;
};

const runCheckout = (
  deployment: VercelDeploymentFixture,
  env: Readonly<Record<string, string>> = {}
) =>
  runStep(
    checkoutStep,
    { "vercel-deployment": deployment },
    {
      NIGHTLY_TARGET: "true",
      PREVIEW_BRANCH: nightlyBranch,
      TARGET_SHA: mainSha,
      WORKSPACE_E2E_BASE_URL: previewUrl,
      WORKSPACE_E2E_VERCEL_PROJECT: vercelProject,
      WORKSPACE_E2E_VERCEL_TOKEN: "synthetic-token",
      ...env,
    },
    fakeCommands
  );

const nightlyDeployment: VercelDeploymentFixture = {
  meta: { githubCommitRef: nightlyBranch, githubCommitSha: mainSha },
  projectId: vercelProject,
  target: null,
};

const suiteStarted = (calls: readonly string[]) =>
  calls.some((call) => call.startsWith("bun turbo test:e2e"));

describe("Workspace E2E nightly preview check", () => {
  test("starts the suite on a preview of the nightly branch at the target SHA", async () => {
    const { calls, result } = await runCheckout(nightlyDeployment);
    expect(result.exitCode).toBe(0);
    expect(suiteStarted(calls)).toBe(true);
  });

  test.each([
    [
      "another branch",
      { meta: { ...nightlyDeployment.meta, githubCommitRef: "feature/x" } },
    ],
    [
      "another commit",
      { meta: { ...nightlyDeployment.meta, githubCommitSha: sha("c") } },
    ],
    ["another project", { projectId: "prj_other" }],
    ["production", { target: "production" }],
  ])(
    "refuses a preview built from %s before any browser action",
    async (_label, override) => {
      const { calls, result } = await runCheckout({
        ...nightlyDeployment,
        ...override,
      });
      expect(result.exitCode).not.toBe(0);
      expect(suiteStarted(calls)).toBe(false);
    }
  );

  test("leaves PR runs to the existing exact-SHA checks", async () => {
    const { calls, result } = await runCheckout(
      {
        ...nightlyDeployment,
        meta: { githubCommitRef: "feature/x", githubCommitSha: sha("c") },
      },
      { NIGHTLY_TARGET: "", PREVIEW_BRANCH: "feature/x" }
    );
    expect(result.exitCode).toBe(0);
    expect(suiteStarted(calls)).toBe(true);
  });
});

describe("Workspace E2E nightly workflow contract", () => {
  test("runs on a schedule and on demand, one run at a time", () => {
    expect(Object.keys(nightlyTriggers).sort()).toEqual([
      "schedule",
      "workflow_dispatch",
    ]);
    expect(nightlyTriggers.schedule).toHaveLength(1);
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

  test("starts only from main, before it moves the nightly branch", async () => {
    const [first] = nightly.jobs["start-nightly-e2e"]?.steps ?? [];
    expect(first?.name).toBe("Refuse to start from a ref other than main");
    expect(first?.env?.LAUNCH_REF).toBe(`\${{ github.ref }}`);
    const launch = (ref: string) =>
      runStep(first, {}, { LAUNCH_REF: ref }).then(
        ({ result }) => result.exitCode
      );
    expect(await launch("refs/heads/main")).toBe(0);
    for (const ref of [
      "refs/heads/feat/automation-builder",
      "refs/heads/main-old",
      "refs/tags/main",
    ]) {
      expect(await launch(ref)).not.toBe(0);
    }
  });
});
