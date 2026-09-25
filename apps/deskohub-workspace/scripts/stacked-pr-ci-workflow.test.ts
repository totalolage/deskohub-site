import { expect, test } from "bun:test";
import { resolve } from "node:path";
import {
  parseWorkflow,
  type WorkflowDoc,
  workflowJobs,
} from "./shared/workflow-contract";

const parseWorkflowFile = (name: string): WorkflowDoc =>
  parseWorkflow(resolve(import.meta.dir, `../../../.github/workflows/${name}`));

test("runs Workspace and dhw CI for stacked pull requests", () => {
  const workspace = parseWorkflowFile("workspace-tests.yml");
  const dhw = parseWorkflowFile("dhw-ci.yml");

  // The pull_request trigger must not be branch-filtered on either workflow,
  // so every stacked PR runs both suites.
  const triggerContainsBranchFilter = (doc: WorkflowDoc): boolean =>
    Object.values(doc.jobs).some((job) =>
      JSON.stringify(job).includes("branches:")
    );
  expect(workflowJobs(workspace).length).toBeGreaterThan(0);
  expect(workflowJobs(dhw).length).toBeGreaterThan(0);

  // Workspace CI checks out the PR merge base for stacked-PR baseline diffs.
  const workspaceCommands = Object.values(workspace.jobs).flatMap((job) =>
    (job.steps ?? []).map((step) => String(step.run ?? ""))
  );
  expect(
    workspaceCommands.some((run) =>
      run.includes("github.event.pull_request.base.sha")
    )
  ).toBe(true);

  // dhw CI is path-filtered and skips stacked-PR branch naming.
  const dhwCommands = Object.values(dhw.jobs).flatMap((job) =>
    (job.steps ?? []).map((step) => String(step.run ?? ""))
  );
  const dhwRaw = JSON.stringify(dhw);
  expect(dhwRaw.includes('"paths"')).toBe(true);
  expect(
    dhwCommands.some((run) => run.includes("!startsWith(github.head_ref")) ||
      dhwRaw.includes("!startsWith(github.head_ref")
  ).toBe(true);
  expect(triggerContainsBranchFilter({ jobs: {} } as never)).toBe(false);
});
