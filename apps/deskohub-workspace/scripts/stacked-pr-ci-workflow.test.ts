import { expect, test } from "bun:test";
import { resolve } from "node:path";
import {
  findStepByName,
  parseWorkflow,
  type WorkflowDoc,
  workflowJobs,
} from "./shared/workflow-contract";

const parseWorkflowFile = (name: string): WorkflowDoc =>
  parseWorkflow(resolve(import.meta.dir, `../../../.github/workflows/${name}`));

type PullRequestTrigger = {
  readonly branches?: unknown;
  readonly "branches-ignore"?: unknown;
  readonly paths?: unknown;
};

const pullRequestTrigger = (doc: WorkflowDoc): PullRequestTrigger | undefined =>
  (doc as WorkflowDoc & { readonly on?: { pull_request?: PullRequestTrigger } })
    .on?.pull_request;

test("runs Workspace and dhw CI for stacked pull requests", () => {
  const workspace = parseWorkflowFile("workspace-tests.yml");
  const dhw = parseWorkflowFile("dhw-ci.yml");

  // The pull_request trigger must not be branch-filtered on either workflow,
  // so every stacked PR runs both suites whatever its base branch.
  expect(workflowJobs(workspace).length).toBeGreaterThan(0);
  expect(workflowJobs(dhw).length).toBeGreaterThan(0);
  for (const doc of [workspace, dhw]) {
    const trigger = pullRequestTrigger(doc);
    expect(trigger).toBeDefined();
    expect(trigger?.branches).toBeUndefined();
    expect(trigger?.["branches-ignore"]).toBeUndefined();
  }

  // Workspace CI diffs migrations against the PR base for stacked PRs. The
  // base SHA reaches the script through step env, never shell interpolation.
  const migrationCount = findStepByName(
    workspace,
    "Validate Workspace migration count"
  );
  expect(migrationCount?.env?.BASE_SHA).toBe(
    "$" + "{{ github.event.pull_request.base.sha }}"
  );
  expect(migrationCount?.run).toContain('"$BASE_SHA"');
  expect(migrationCount?.run).not.toContain("$" + "{{");

  // dhw CI is path-filtered and skips stacked-PR branch naming.
  expect(pullRequestTrigger(dhw)?.paths).toBeDefined();
  expect(JSON.stringify(dhw).includes("!startsWith(github.head_ref")).toBe(
    true
  );
});
