import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Schema } from "effect";
import { runCommand } from "./command";
import type { WorkflowStep } from "./workflow-contract";

export const workflowStepRepository = "owner/repo";
export const workflowStepRunId = "99";

/** GitHub API response bodies the fake `gh` returns, keyed by API path. */
export type GhFixtures = Readonly<Record<string, Schema.Json>>;

// Stands in for the GitHub CLI: each API path answers from a fixture file and
// any other call fails, so a test also proves which requests the step makes.
// A fixture keyed by a request field, such as `deployments@sha=<sha>`, wins
// over the path's own. Every call is logged for assertions on what the step
// published.
const fakeGh = `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> "$GH_FIXTURES/calls.log"
path=""
previous=""
fields=()
for arg in "$@"; do
  case "$arg" in
    repos/*) path="\${arg#repos/*/*/}" ;;
  esac
  if [[ "$previous" == "-f" || "$previous" == "-F" ]]; then
    fields+=("$arg")
  fi
  previous="$arg"
done
path="\${path%%\\?*}"
file="$GH_FIXTURES/\${path//\\//_}.json"
for field in "\${fields[@]}"; do
  keyed="$GH_FIXTURES/\${path//\\//_}@\${field//\\//_}.json"
  if [[ -f "$keyed" ]]; then
    file="$keyed"
  fi
done
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

/**
 * Runs workflow step scripts with a fake `gh` that answers API paths from
 * fixtures, and returns each step's outputs and logged `gh` calls. Call
 * `cleanup` once the tests finish.
 */
export const createWorkflowStepRunner = (prefix: string) => {
  const root = mkdtempSync(join(tmpdir(), prefix));
  let runIndex = 0;

  /**
   * `commands` adds fake executables beside `gh`, as bash scripts keyed by
   * command name; they can read `$GH_FIXTURES` and append to its `calls.log`.
   */
  const runStep = async (
    step: WorkflowStep | undefined,
    fixtures: GhFixtures,
    env: Readonly<Record<string, string>>,
    commands: Readonly<Record<string, string>> = {}
  ) => {
    const dir = join(root, `run-${runIndex++}`);
    const bin = join(dir, "bin");
    const fixtureDir = join(dir, "fixtures");
    mkdirSync(bin, { recursive: true });
    mkdirSync(fixtureDir);
    for (const [name, script] of Object.entries({ ...commands, gh: fakeGh })) {
      writeFileSync(join(bin, name), script);
      chmodSync(join(bin, name), 0o755);
    }
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
      Object.entries(step?.env ?? {})
        .filter(([, value]) => !String(value).includes("${{"))
        .map(([name, value]) => [name, String(value)])
    );
    const result = await runCommand(["bash", "-c", step?.run ?? ""], {
      cwd: dir,
      env: {
        ...stepEnv,
        ...env,
        GH_FIXTURES: fixtureDir,
        GITHUB_OUTPUT: output,
        GITHUB_REPOSITORY: workflowStepRepository,
        GITHUB_RUN_ATTEMPT: "1",
        GITHUB_RUN_ID: workflowStepRunId,
        GITHUB_SERVER_URL: "https://github.com",
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
    const callLog = join(fixtureDir, "calls.log");
    const calls = existsSync(callLog)
      ? readFileSync(callLog, "utf8").split("\n").filter(Boolean)
      : [];
    return { calls, outputs, result };
  };

  const cleanup = () => rmSync(root, { force: true, recursive: true });

  return { cleanup, runStep };
};
