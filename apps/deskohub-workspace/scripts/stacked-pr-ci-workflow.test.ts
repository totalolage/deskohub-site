import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runCommand } from "./shared/command";
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
});

test("requires a releasable dhw commit only for changes shipped with dhw", async () => {
  const releaseIntent = findStepByName(
    parseWorkflowFile("dhw-ci.yml"),
    "Require a releasable CLI commit"
  );
  expect(releaseIntent?.run).toBeDefined();
  const script = releaseIntent?.run ?? "";

  // A stand-in `gh` serves the PR's files and commits as the REST API does
  // and applies the step's own `--jq` filter to them.
  const fakeBin = mkdtempSync(join(tmpdir(), "dhw-release-intent-"));
  writeFileSync(
    join(fakeBin, "gh"),
    `#!/bin/sh
response=
filter=
while [ "$#" -gt 0 ]; do
  case "$1" in
    --jq) filter="$2"; shift ;;
    */files) response="$PR_FILES" ;;
    */commits) response="$PR_COMMITS" ;;
  esac
  shift
done
[ -n "$response" ] && [ -n "$filter" ] || exit 2
printf '%s' "$response" | jq -r "$filter"
`,
    { mode: 0o755 }
  );
  const releaseIntentExitCode = async (
    files: ReadonlyArray<string>,
    commits: ReadonlyArray<string>
  ) => {
    const result = await runCommand(
      ["bash", "--noprofile", "--norc", "-e", "-o", "pipefail", "-c", script],
      {
        env: {
          PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
          GITHUB_REPOSITORY: "synthetic/repository",
          PR_NUMBER: "1",
          PR_FILES: JSON.stringify(files.map((filename) => ({ filename }))),
          PR_COMMITS: JSON.stringify(
            commits.map((message) => ({ commit: { message } }))
          ),
        },
        timeoutMs: 5000,
      }
    );
    expect(result.timedOut).toBe(false);
    return result.exitCode;
  };

  try {
    // Tests and recorded fixtures never ship in the binary.
    expect(
      await releaseIntentExitCode(
        [
          "packages/workspace-admin-api/src/campaign-operation-wire-contract.test.ts",
          "packages/workspace-admin-api/src/campaign-operation-wire-contract.golden.json",
          "apps/dhw/src/commands.test.ts",
        ],
        ["test(admin-api): pin the wire contract"]
      )
    ).toBe(0);
    // Release Please attributes a contract change to dhw only through apps/dhw.
    expect(
      await releaseIntentExitCode(
        ["packages/workspace-admin-api/src/email-campaigns.ts"],
        ["feat(dhw): change the campaign contract"]
      )
    ).toBe(1);
    expect(
      await releaseIntentExitCode(
        [
          "packages/workspace-admin-api/src/email-campaigns.ts",
          "apps/dhw/src/commands.ts",
        ],
        ["refactor(admin-api): reshape", "feat(dhw): send campaigns"]
      )
    ).toBe(0);
    expect(
      await releaseIntentExitCode(
        ["apps/dhw/src/commands.ts"],
        ["fix(dhw): send campaigns"]
      )
    ).toBe(0);
    expect(
      await releaseIntentExitCode(
        ["apps/dhw/src/commands.ts"],
        ["refactor(dhw): reshape the commands"]
      )
    ).toBe(1);
  } finally {
    rmSync(fakeBin, { recursive: true, force: true });
  }
});
