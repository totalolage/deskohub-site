import { afterAll, describe, expect, test } from "bun:test";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runCommand } from "./shared/command";
import { findStepByName, parseWorkflow } from "./shared/workflow-contract";

const workflow = parseWorkflow(
  resolve(import.meta.dir, "../../../.github/workflows/workspace-e2e.yml")
);
const targetStep = findStepByName(
  workflow,
  "Resolve eligible PR and immutable preview"
);
const statusStep = findStepByName(workflow, "Decide status without an E2E run");

const repository = "owner/repo";
const prNumber = 7;
const sha = (digit: string) => digit.repeat(40);
const targetSha = sha("a");
const previewUrl = "https://deskohub-workspace-site-abc123-team.vercel.app";

// Stands in for the GitHub CLI: each API path answers from a fixture file and
// any other call fails, so a test also proves which requests the step makes.
const fakeGh = `#!/usr/bin/env bash
set -euo pipefail
path=""
for arg in "$@"; do
  case "$arg" in
    repos/*) path="\${arg#repos/*/*/}" ;;
  esac
done
path="\${path%%\\?*}"
file="$GH_FIXTURES/\${path//\\//_}.json"
if [[ ! -f "$file" ]]; then
  echo "unexpected gh call: $*" >&2
  exit 1
fi
if [[ " $* " == *" --slurp "* ]]; then
  printf '['
  cat "$file"
  printf ']'
else
  cat "$file"
fi
`;

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

const root = mkdtempSync(join(tmpdir(), "workspace-e2e-status-"));
afterAll(() => rmSync(root, { force: true, recursive: true }));

let runIndex = 0;

const runStep = async (
  step: typeof statusStep,
  fixtures: Readonly<Record<string, readonly object[]>>,
  env: Readonly<Record<string, string>>
) => {
  const dir = join(root, `run-${runIndex++}`);
  const bin = join(dir, "bin");
  const fixtureDir = join(dir, "fixtures");
  mkdirSync(bin, { recursive: true });
  mkdirSync(fixtureDir);
  writeFileSync(join(bin, "gh"), fakeGh);
  chmodSync(join(bin, "gh"), 0o755);
  for (const [path, body] of Object.entries(fixtures)) {
    writeFileSync(
      join(fixtureDir, `${path.replaceAll("/", "_")}.json`),
      JSON.stringify(body)
    );
  }
  const output = join(dir, "output");
  const summary = join(dir, "summary");
  writeFileSync(output, "");
  writeFileSync(summary, "");
  const stepEnv = Object.fromEntries(
    Object.entries(step?.env ?? {}).filter(
      ([, value]) => !String(value).includes("${{")
    )
  );
  const result = await runCommand(["bash", "-c", step?.run ?? ""], {
    cwd: dir,
    env: {
      ...stepEnv,
      ...env,
      GH_FIXTURES: fixtureDir,
      GITHUB_OUTPUT: output,
      GITHUB_REPOSITORY: repository,
      GITHUB_STEP_SUMMARY: summary,
      HOME: dir,
      PATH: `${bin}:${process.env.PATH}`,
    },
    timeoutMs: 15_000,
  });
  const outputs = Object.fromEntries(
    readFileSync(output, "utf8")
      .split("\n")
      .filter((line) => line.includes("="))
      .map((line) => [
        line.slice(0, line.indexOf("=")),
        line.slice(line.indexOf("=") + 1),
      ])
  );
  return { outputs, result };
};

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

  test("fails when the target is missing from the PR history", async () => {
    const { result } = await decideStatus("skipped", {
      commits: [{ sha: sha("b"), tree: "tree-same" }],
    });
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("missing from the matching PR history");
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
    const run = statusStep?.run ?? "";
    for (const [, description] of run.matchAll(
      /decide \w+ ["']([^"']+)["']/g
    )) {
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
  });
});

describe("Workspace E2E target resolution", () => {
  const resolveTarget = (
    deployment: string,
    deploymentStatus: { readonly description: string; readonly state: string }
  ) =>
    runStep(
      targetStep,
      {
        deployments: [{ creator: { login: "vercel[bot]" }, id: 11 }],
        "deployments/11/statuses": [
          { ...deploymentStatus, environment_url: `${previewUrl}/` },
        ],
        [`commits/${targetSha}/pulls`]: [
          {
            draft: false,
            head: {
              ref: "feature/x",
              repo: { full_name: repository },
              sha: targetSha,
            },
            number: prNumber,
            state: "open",
            user: { login: "author" },
          },
        ],
      },
      {
        TARGET_DEPLOYMENT: deployment,
        TARGET_REF: "feature/x",
        TARGET_SHA: targetSha,
        TARGET_URL: previewUrl,
      }
    );

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

    const rejected = await resolveTarget("failed", {
      description: "Deployment has completed",
      state: "success",
    });
    expect(rejected.result.exitCode).not.toBe(0);
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
  });

  test("rejects deployment states it does not handle", async () => {
    const { result } = await resolveTarget("canceled", {
      description: "Deployment has been canceled",
      state: "inactive",
    });
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("Unsupported Vercel deployment state");
  });
});
