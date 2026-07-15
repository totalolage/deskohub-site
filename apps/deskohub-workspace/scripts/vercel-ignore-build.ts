import { fileURLToPath } from "node:url";

type IgnoreBuildDecision = {
  readonly exitCode: 0 | 1;
  readonly reason: string;
};

type DecideIgnoreBuildInput = {
  readonly changedPaths?: ReadonlyArray<string>;
  readonly e2eMarker?: string;
  readonly gitDiffFailed?: boolean;
  readonly previousSha?: string;
  readonly vercelEnvironment?: string;
};

const testFilePattern = /(?:^|\/)[^/]+\.(?:test|spec)\.[cm]?[jt]sx?$/;
const gitShaPattern = /^[0-9a-f]{7,64}$/i;

const decideBeforeGitDiff = ({
  e2eMarker,
  previousSha,
  vercelEnvironment,
}: DecideIgnoreBuildInput): IgnoreBuildDecision | undefined => {
  if (vercelEnvironment !== "preview") {
    return { exitCode: 1, reason: "environment requires a build" };
  }

  if (e2eMarker === "HUMAN") {
    return { exitCode: 1, reason: "fresh E2E deployment requires a build" };
  }

  if (!previousSha || !gitShaPattern.test(previousSha)) {
    return { exitCode: 1, reason: "previous deployment SHA is unavailable" };
  }
};

export const isNonRuntimePath = (path: string) =>
  path === "AGENTS.md" ||
  path === "README.md" ||
  path.endsWith("/README.md") ||
  path.startsWith("docs/") ||
  path.includes("/docs/") ||
  path.startsWith(".github/") ||
  testFilePattern.test(path) ||
  path.startsWith("apps/deskohub-workspace/e2e/") ||
  path === "apps/deskohub-workspace/scripts/workspace-e2e.ts" ||
  path === "apps/deskohub-workspace/tsconfig.test.json";

export const decideIgnoreBuild = ({
  changedPaths,
  e2eMarker,
  gitDiffFailed = false,
  previousSha,
  vercelEnvironment,
}: DecideIgnoreBuildInput): IgnoreBuildDecision => {
  const preDiffDecision = decideBeforeGitDiff({
    e2eMarker,
    previousSha,
    vercelEnvironment,
  });
  if (preDiffDecision) return preDiffDecision;

  if (gitDiffFailed || !changedPaths) {
    return { exitCode: 1, reason: "changed paths could not be determined" };
  }

  if (changedPaths.length === 0) {
    return { exitCode: 1, reason: "changed path list is empty" };
  }

  const runtimePath = changedPaths.find((path) => !isNonRuntimePath(path));
  if (runtimePath) {
    return {
      exitCode: 1,
      reason: `runtime-relevant path changed: ${runtimePath}`,
    };
  }

  return { exitCode: 0, reason: "all changed paths are non-runtime" };
};

export const parseChangedPaths = (output: Uint8Array) =>
  new TextDecoder().decode(output).split("\0").filter(Boolean);

export const getGitDiffArgs = (previousSha: string) => [
  "git",
  "-C",
  fileURLToPath(new URL("../../..", import.meta.url)),
  "diff",
  "--no-renames",
  "--name-only",
  "-z",
  `${previousSha}...HEAD`,
  "--",
];

const run = () => {
  const previousSha = process.env.VERCEL_GIT_PREVIOUS_SHA;
  const preDiffDecision = decideBeforeGitDiff({
    e2eMarker: process.env.WORKSPACE_E2E_BOTID_BYPASS,
    previousSha,
    vercelEnvironment: process.env.VERCEL_ENV,
  });
  if (preDiffDecision) return preDiffDecision;
  if (!previousSha) {
    return { exitCode: 1, reason: "previous deployment SHA is unavailable" };
  }

  const git = Bun.spawnSync(getGitDiffArgs(previousSha), {
    stderr: "ignore",
  });

  return decideIgnoreBuild({
    changedPaths:
      git.exitCode === 0 ? parseChangedPaths(git.stdout) : undefined,
    e2eMarker: process.env.WORKSPACE_E2E_BOTID_BYPASS,
    gitDiffFailed: git.exitCode !== 0,
    previousSha,
    vercelEnvironment: process.env.VERCEL_ENV,
  });
};

if (import.meta.main) {
  const decision = run();
  process.stdout.write(`Workspace preview decision: ${decision.reason}\n`);
  process.exit(decision.exitCode);
}
