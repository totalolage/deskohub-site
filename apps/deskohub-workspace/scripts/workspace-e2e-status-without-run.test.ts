import { afterAll, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { findStepByName, parseWorkflow } from "./shared/workflow-contract";
import {
  createWorkflowStepRunner,
  workflowStepRepository as repository,
} from "./shared/workflow-step-runner";

const workflow = parseWorkflow(
  resolve(import.meta.dir, "../../../.github/workflows/workspace-e2e.yml")
);
const targetStep = findStepByName(
  workflow,
  "Resolve eligible PR and immutable preview"
);
const statusStep = findStepByName(workflow, "Decide status without an E2E run");
const publishStep = findStepByName(
  workflow,
  "Publish status without an E2E run"
);

const prNumber = 7;
const sha = (digit: string) => digit.repeat(40);
const targetSha = sha("a");
const previewUrl = "https://deskohub-workspace-site-abc123-team.vercel.app";

type Status = {
  readonly context?: string;
  readonly creator?: string;
  readonly description: string;
  readonly state: string;
};

type Scenario = {
  readonly commits: readonly { readonly sha: string; readonly tree: string }[];
  readonly statuses?: Readonly<Record<string, readonly Status[]>>;
};

const { cleanup, runStep } = createWorkflowStepRunner("workspace-e2e-status-");
afterAll(cleanup);

const decideStatus = (deployment: string, scenario: Scenario) =>
  runStep(
    statusStep,
    {
      [`pulls/${prNumber}/commits`]: scenario.commits.map((commit) => ({
        commit: { tree: { sha: commit.tree } },
        sha: commit.sha,
      })),
      ...Object.fromEntries(
        Object.entries(scenario.statuses ?? {}).map(([commit, statuses]) => [
          `commits/${commit}/statuses`,
          statuses.map((status) => ({
            context: status.context ?? "Workspace E2E",
            creator: { login: status.creator ?? "github-actions[bot]" },
            description: status.description,
            state: status.state,
          })),
        ])
      ),
    },
    {
      DEPLOYMENT: deployment,
      PR_NUMBER: String(prNumber),
      RESOLUTION_ERROR: "",
      TARGET_OUTCOME: "success",
      TARGET_SHA: targetSha,
    }
  );

const passed = {
  description: "Protected preview E2E passed",
  state: "success",
} as const;
const failed = {
  description: "Protected preview E2E failed",
  state: "failure",
} as const;
const running = {
  description: "Protected preview E2E is running",
  state: "pending",
} as const;
const superseded = {
  description: String(statusStep?.env?.E2E_SUPERSEDED_DESCRIPTION),
  state: "failure",
} as const;

describe("Workspace E2E status without a run", () => {
  test("never carries a pass across a different tree", async () => {
    // PR #729: an older head passed, the next head's deployment failed, and
    // Vercel skipped the empty retrigger on top of it.
    const { outputs, result } = await decideStatus("skipped", {
      commits: [
        { sha: sha("b"), tree: "tree-old" },
        { sha: sha("c"), tree: "tree-new" },
        { sha: targetSha, tree: "tree-new" },
      ],
      statuses: { [sha("b")]: [passed], [sha("c")]: [] },
    });
    expect(result.exitCode).toBe(0);
    expect(outputs.state).toBe("failure");
    expect(outputs.description).toContain("no E2E-tested commit has its tree");
  });

  test("reuses a run on a commit with the identical tree", async () => {
    const { outputs, result } = await decideStatus("skipped", {
      commits: [
        { sha: sha("b"), tree: "tree-same" },
        { sha: targetSha, tree: "tree-same" },
      ],
      statuses: { [sha("b")]: [passed, running] },
    });
    expect(result.exitCode).toBe(0);
    expect(outputs).toMatchObject({
      description: "Same tree as bbbbbbb, which passed E2E",
      state: "success",
    });
  });

  test("ignores statuses an earlier skip carried forward", async () => {
    const { outputs } = await decideStatus("skipped", {
      commits: [
        { sha: sha("b"), tree: "tree-same" },
        { sha: targetSha, tree: "tree-same" },
      ],
      statuses: {
        [sha("b")]: [
          { description: "Workspace unchanged; E2E skipped", state: "success" },
        ],
      },
    });
    expect(outputs.state).toBe("failure");
  });

  test("ignores other contexts and other publishers", async () => {
    const { outputs } = await decideStatus("skipped", {
      commits: [
        { sha: sha("b"), tree: "tree-same" },
        { sha: targetSha, tree: "tree-same" },
      ],
      statuses: {
        [sha("b")]: [
          { ...passed, context: "Workspace E2E allocation" },
          { ...passed, creator: "someone" },
        ],
      },
    });
    expect(outputs.state).toBe("failure");
  });

  test("takes the nearest identical-tree run, including a failure", async () => {
    const { outputs } = await decideStatus("skipped", {
      commits: [
        { sha: sha("b"), tree: "tree-same" },
        { sha: sha("c"), tree: "tree-same" },
        { sha: sha("d"), tree: "tree-same" },
        { sha: targetSha, tree: "tree-same" },
      ],
      statuses: { [sha("b")]: [passed], [sha("c")]: [failed], [sha("d")]: [] },
    });
    expect(outputs).toMatchObject({
      description: "Same tree as ccccccc, which failed E2E",
      state: "failure",
    });
  });

  test("asks for a rerun while the identical-tree run is still running", async () => {
    const { outputs } = await decideStatus("skipped", {
      commits: [
        { sha: sha("b"), tree: "tree-same" },
        { sha: targetSha, tree: "tree-same" },
      ],
      statuses: { [sha("b")]: [running] },
    });
    expect(outputs.state).toBe("failure");
    expect(outputs.description).toContain("rerun this check");
  });

  test("passes over a run a newer head superseded", async () => {
    // The superseded run published "running", then stopped without a result.
    const { outputs, result } = await decideStatus("skipped", {
      commits: [
        { sha: sha("b"), tree: "tree-same" },
        { sha: sha("c"), tree: "tree-same" },
        { sha: targetSha, tree: "tree-same" },
      ],
      statuses: { [sha("b")]: [passed], [sha("c")]: [superseded, running] },
    });
    expect(result.exitCode).toBe(0);
    expect(outputs).toMatchObject({
      description: "Same tree as bbbbbbb, which passed E2E",
      state: "success",
    });
  });

  test("fails with a published description when the target is missing from the PR history", async () => {
    const { outputs, result } = await decideStatus("skipped", {
      commits: [{ sha: sha("b"), tree: "tree-same" }],
    });
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("missing from the matching PR history");
    expect(outputs.state).toBe("failure");
    expect(outputs.description).toContain("missing from this PR's commit list");
  });

  test("fails a failed deployment with an actionable description", async () => {
    const { outputs, result } = await decideStatus("failed", { commits: [] });
    expect(result.exitCode).toBe(0);
    expect(outputs).toMatchObject({
      description:
        "Vercel preview deployment failed; fix or redeploy it to run E2E",
      state: "failure",
    });
  });

  test("keeps every published status description within GitHub's limit", () => {
    const descriptions = [
      ...(statusStep?.run ?? "").matchAll(/decide \w+ ["']([^"']+)["']/g),
      ...(targetStep?.run ?? "").matchAll(
        /fail ["'][^"']+["'] \\\n\s+["']([^"']+)["']/g
      ),
      ...String(publishStep?.env?.STATUS_DESCRIPTION).matchAll(
        /\|\| '([^']+)'/g
      ),
      ["", superseded.description],
    ].map(([, description]) => description ?? "");
    expect(descriptions.length).toBeGreaterThanOrEqual(10);
    for (const description of descriptions) {
      expect(
        description.replace(/\$\{sha:0:7\}/, "0000000").length
      ).toBeLessThanOrEqual(140);
    }
  });

  test("recognizes exactly the descriptions a real run publishes", () => {
    const descriptions = JSON.parse(
      String(statusStep?.env?.E2E_RUN_DESCRIPTIONS)
    ) as string[];
    const publishers = [
      findStepByName(workflow, "Publish pending commit status"),
      findStepByName(workflow, "Publish final commit status"),
    ]
      .map((step) => step?.run ?? "")
      .join("\n");
    for (const description of descriptions) {
      expect(publishers).toContain(description);
    }
    expect(descriptions).toHaveLength(3);
    expect(superseded.description).toBe(
      String(
        findStepByName(workflow, "Publish final commit status")?.env
          ?.SUPERSEDED_DESCRIPTION
      )
    );
  });
});

type DeploymentStatus = {
  readonly description: string;
  readonly state: string;
};

const pullRequest = {
  draft: false,
  head: { ref: "feature/x", repo: { full_name: repository }, sha: targetSha },
  number: prNumber,
  state: "open",
  user: { login: "author" },
};

const resolveTarget = (
  deployment: string,
  deploymentStatus: DeploymentStatus | null,
  pulls: readonly object[] = [pullRequest],
  overrides: Readonly<Record<string, string>> = {}
) =>
  runStep(
    targetStep,
    {
      deployments: [{ creator: { login: "vercel[bot]" }, id: 11 }],
      "deployments/11/statuses": deploymentStatus
        ? [{ ...deploymentStatus, environment_url: `${previewUrl}/` }]
        : [],
      [`commits/${targetSha}/pulls`]: pulls,
    },
    {
      EVENT_NAME: "repository_dispatch",
      INCLUDE_NIGHTLY_CASES: "false",
      TARGET_DEPLOYMENT: deployment,
      TARGET_REF: "feature/x",
      TARGET_SHA: targetSha,
      TARGET_URL: previewUrl,
      ...overrides,
    }
  );

const deploymentSucceeded = {
  description: "Deployment has completed",
  state: "success",
} as const;

describe("Workspace E2E target resolution", () => {
  test("accepts a failed deployment only with a failed exact-SHA status", async () => {
    const accepted = await resolveTarget("failed", {
      description: "Deployment has failed",
      state: "failure",
    });
    expect(accepted.result.exitCode).toBe(0);
    expect(accepted.outputs).toMatchObject({
      deployment: "failed",
      eligible: "true",
      pr_number: String(prNumber),
    });

    const rejected = await resolveTarget("failed", deploymentSucceeded);
    expect(rejected.result.exitCode).not.toBe(0);
    expect(rejected.outputs.url).toBeUndefined();
  });

  test("accepts a skip only with Vercel's skipped status", async () => {
    const accepted = await resolveTarget("skipped", {
      description: "Skipped - Not affected",
      state: "inactive",
    });
    expect(accepted.outputs.deployment).toBe("skipped");

    const rejected = await resolveTarget("skipped", {
      description: "Deployment has failed",
      state: "failure",
    });
    expect(rejected.result.exitCode).not.toBe(0);
    expect(rejected.outputs.url).toBeUndefined();
  });

  test("rejects deployment states it does not handle", async () => {
    const { outputs, result } = await resolveTarget("canceled", {
      description: "Deployment has been canceled",
      state: "inactive",
    });
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("Unsupported Vercel deployment state");
    expect(outputs.eligible).toBeUndefined();
  });

  test("leaves an event for a superseded head ineligible before reading its preview", async () => {
    // A late event for an older head: the PR has moved on, so the run never
    // reaches the E2E job and its concurrency group, which alone cancels.
    const { calls, outputs, result } = await resolveTarget(
      "success",
      deploymentSucceeded,
      [{ ...pullRequest, head: { ...pullRequest.head, sha: sha("f") } }]
    );
    expect(result.exitCode).toBe(0);
    expect(outputs).toEqual({ eligible: "false" });
    expect(calls.some((call) => call.includes("/deployments"))).toBe(false);
  });

  test("keeps the eligible head and a recovery description when its preview record is missing", async () => {
    const { outputs, result } = await resolveTarget("success", null);
    expect(result.exitCode).not.toBe(0);
    expect(outputs).toMatchObject({
      eligible: "true",
      pr_number: String(prNumber),
      sha: targetSha,
    });
    expect(outputs.resolution_error).toContain("re-run the failed jobs");
    expect(outputs.url).toBeUndefined();
  });

  test("records a failure when more than one eligible PR has the head", async () => {
    const { outputs, result } = await resolveTarget(
      "success",
      deploymentSucceeded,
      [pullRequest, { ...pullRequest, number: prNumber + 1 }]
    );
    expect(result.exitCode).not.toBe(0);
    expect(outputs.eligible).toBe("true");
    expect(outputs.resolution_error).toContain("More than one open PR");
    expect(outputs.pr_number).toBeUndefined();
  });
});

const nightlyBranch = String(targetStep?.env?.NIGHTLY_BRANCH);

const resolveNightlyTarget = ({
  eventName = "workflow_dispatch",
  includeNightlyCases = "true",
  mainRelation = "ahead",
  nightlyHead = targetSha,
  pulls = [],
}: {
  readonly eventName?: string;
  readonly includeNightlyCases?: "false" | "true";
  readonly mainRelation?: string;
  readonly nightlyHead?: string;
  readonly pulls?: readonly object[];
} = {}) =>
  runStep(
    targetStep,
    {
      [`commits/${targetSha}/pulls`]: pulls,
      [`compare/${targetSha}...main`]: { status: mainRelation },
      deployments: [{ creator: { login: "vercel[bot]" }, id: 11 }],
      "deployments/11/statuses": [
        { ...deploymentSucceeded, environment_url: `${previewUrl}/` },
      ],
      [`git/ref/heads/${nightlyBranch}`]: { object: { sha: nightlyHead } },
    },
    {
      EVENT_NAME: eventName,
      INCLUDE_NIGHTLY_CASES: includeNightlyCases,
      TARGET_DEPLOYMENT: "success",
      TARGET_REF: nightlyBranch,
      TARGET_SHA: targetSha,
      TARGET_URL: previewUrl,
    }
  );

describe("Workspace E2E nightly target resolution", () => {
  test("accepts the nightly branch head on main without a PR", async () => {
    const { outputs, result } = await resolveNightlyTarget();
    expect(result.exitCode).toBe(0);
    expect(outputs).toEqual({
      deployment: "success",
      eligible: "true",
      head_ref: nightlyBranch,
      nightly: "true",
      nightly_cases: "true",
      sha: targetSha,
      url: previewUrl,
    });
  });

  test("runs only the default cases on a nightly target that doesn't ask for more", async () => {
    const { outputs, result } = await resolveNightlyTarget({
      includeNightlyCases: "false",
    });
    expect(result.exitCode).toBe(0);
    expect(outputs.nightly).toBe("true");
    expect(outputs.nightly_cases).toBeUndefined();
  });

  test("refuses nightly cases for a PR target before it resolves the PR", async () => {
    // D38: nightly cases test main only, so this dispatch fails without
    // marking the PR eligible, which would publish its required status.
    const { calls, outputs, result } = await resolveTarget(
      "success",
      deploymentSucceeded,
      [pullRequest],
      { EVENT_NAME: "workflow_dispatch", INCLUDE_NIGHTLY_CASES: "true" }
    );
    expect(result.exitCode).not.toBe(0);
    expect(outputs).toEqual({});
    expect(calls).toEqual([]);
  });

  test("never passes nightly cases to the suite without a validated nightly target", () => {
    expect(
      findStepByName(workflow, "Run checkout E2E")?.env
        ?.WORKSPACE_E2E_NIGHTLY_CASES
    ).toBe(
      `\${{ needs.resolve-target.outputs.nightly == 'true' && needs.resolve-target.outputs.nightly_cases == 'true' && 'true' || '' }}`
    );
    expect(workflow.jobs["resolve-target"]?.outputs?.nightly_cases).toBe(
      `\${{ steps.target.outputs.nightly_cases }}`
    );
  });

  test("accepts main's own head", async () => {
    const { result } = await resolveNightlyTarget({
      mainRelation: "identical",
    });
    expect(result.exitCode).toBe(0);
  });

  test("refuses a SHA the nightly branch no longer points at", async () => {
    const { outputs, result } = await resolveNightlyTarget({
      nightlyHead: sha("f"),
    });
    expect(result.exitCode).not.toBe(0);
    expect(outputs.nightly).toBe("true");
    expect(outputs.url).toBeUndefined();
  });

  test("refuses a nightly branch head outside main", async () => {
    const { outputs, result } = await resolveNightlyTarget({
      mainRelation: "diverged",
    });
    expect(result.exitCode).not.toBe(0);
    expect(outputs.url).toBeUndefined();
  });

  test("leaves Vercel's own nightly branch events ineligible", async () => {
    // Only the nightly workflow's dispatch tests the branch, after it has
    // waited for the preview.
    for (const pulls of [
      [],
      [{ ...pullRequest, head: { ...pullRequest.head, ref: nightlyBranch } }],
    ]) {
      const { outputs, result } = await resolveNightlyTarget({
        eventName: "repository_dispatch",
        includeNightlyCases: "false",
        pulls,
      });
      expect(result.exitCode).toBe(0);
      expect(outputs).toEqual({ eligible: "false" });
    }
  });

  test("publishes no PR status for a nightly target", () => {
    const nightlyOff = "needs.resolve-target.outputs.nightly != 'true'";
    expect(statusStep?.if).toContain("steps.target.outputs.nightly != 'true'");
    for (const job of [
      "cancel-superseded-run",
      "publish-final-status",
      "publish-status-without-run",
    ]) {
      expect(workflow.jobs[job]?.if).toContain(nightlyOff);
    }
    for (const name of [
      "Stop unless this SHA is still the PR head",
      "Release the lease unless this SHA is still the PR head",
      "Publish allocation status",
      "Publish pending commit status",
    ]) {
      expect(findStepByName(workflow, name)?.if).toBe(nightlyOff);
    }
    expect(workflow.jobs["resolve-target"]?.outputs?.nightly).toContain(
      "steps.target.outputs.nightly"
    );
  });
});

describe("Workspace E2E status after a failed resolution", () => {
  // The publishing job's expression falls back to this generic failure.
  const [, fallbackDescription = ""] =
    /\|\| '([^']+)'/.exec(String(publishStep?.env?.STATUS_DESCRIPTION)) ?? [];

  const publishedStatus = async (
    target: Awaited<ReturnType<typeof resolveTarget>>
  ) => {
    const decided = await runStep(
      statusStep,
      {},
      {
        DEPLOYMENT: target.outputs.deployment ?? "",
        PR_NUMBER: target.outputs.pr_number ?? "",
        RESOLUTION_ERROR: target.outputs.resolution_error ?? "",
        TARGET_OUTCOME: target.result.exitCode === 0 ? "success" : "failure",
        TARGET_SHA: target.outputs.sha ?? "",
      }
    );
    expect(decided.result.exitCode).toBe(0);
    const published = await runStep(
      publishStep,
      { [`statuses/${targetSha}`]: [] },
      {
        STATUS_DESCRIPTION: decided.outputs.description ?? fallbackDescription,
        STATUS_STATE: decided.outputs.state ?? "failure",
        TARGET_SHA: target.outputs.sha ?? "",
      }
    );
    expect(published.result.exitCode).toBe(0);
    return published.calls;
  };

  test("publishes the recovery description for a missing preview record", async () => {
    const calls = await publishedStatus(await resolveTarget("success", null));
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain(`repos/${repository}/statuses/${targetSha}`);
    expect(calls[0]).toContain("state=failure");
    expect(calls[0]).toContain("context=Workspace E2E");
    expect(calls[0]).toContain(
      "No Vercel deployment record matches this preview yet"
    );
  });

  test("publishes a failure when the target step failed without a description", async () => {
    const target = await resolveTarget("success", deploymentSucceeded);
    const calls = await publishedStatus({
      ...target,
      outputs: { eligible: "true", sha: targetSha },
      result: { ...target.result, exitCode: 1 },
    });
    expect(calls[0]).toContain("state=failure");
    expect(fallbackDescription).toContain("re-run the failed jobs");
    expect(calls[0]).toContain(`description=${fallbackDescription}`);
  });

  test("routes every eligible head without an E2E run to the status publisher", () => {
    const resolveJob = workflow.jobs["resolve-target"];
    expect(resolveJob?.outputs?.eligible).toContain("steps.target.outputs");
    expect(resolveJob?.outputs?.status_description).toContain(
      "steps.status-without-run.outputs.description"
    );
    expect(resolveJob?.outputs?.status_state).toContain(
      "steps.status-without-run.outputs.state"
    );
    expect(statusStep?.if).toContain("!cancelled()");
    expect(statusStep?.if).toContain("steps.target.outcome != 'success'");
    const withoutRun = workflow.jobs["publish-status-without-run"]?.if ?? "";
    expect(withoutRun).toContain("!cancelled()");
    expect(withoutRun).toContain("needs.resolve-target.result != 'success'");
    // The final-status job owns only heads whose resolution succeeded.
    expect(workflow.jobs["publish-final-status"]?.if).toContain(
      "needs.resolve-target.result == 'success'"
    );
  });
});
