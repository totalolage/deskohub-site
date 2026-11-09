import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  changedPathsBetween,
  comparisonBase,
  type DeploymentSummary,
  decideRebuild,
  isRecoverableSkip,
  isSuperseded,
  type PortalDeployments,
  readPackageGraph,
  recoverSkippedDeployment,
} from "./rebuild-skipped-deployment";

const graph = {
  packagePaths: [
    ".agents",
    "apps/deskohub-portal",
    "apps/deskohub-workspace",
    "packages/dotypos",
    "packages/dotypos-extra",
    "packages/i18n",
  ],
  portalPackagePaths: ["apps/deskohub-portal", "packages/i18n"],
};

describe("decideRebuild", () => {
  test.each([
    ["portal source", "apps/deskohub-portal/src/pages/index.astro"],
    ["a package the portal depends on", "packages/i18n/src/index.ts"],
    ["the lockfile", "bun.lock"],
    ["the root manifest", "package.json"],
    ["another app's manifest", "apps/deskohub-workspace/package.json"],
    ["a package manifest", "packages/dotypos/package.json"],
    ["a root configuration file", "turbo.json"],
    ["a root directory outside the packages", "lint/rule.grit"],
    ["a GitHub workflow", ".github/workflows/ci.yml"],
    ["a file named like a package prefix", "packages/dotypos-extra-x/a.ts"],
  ])("rebuilds when %s changed", (_name, path) => {
    expect(decideRebuild([path], graph).rebuild).toBe(true);
  });

  test.each([
    ["agent skills", ".agents/skills/example/SKILL.md"],
    ["agent skill metadata", ".agents/skills/example/agents/openai.yaml"],
    ["Workspace source", "apps/deskohub-workspace/app/page.tsx"],
    ["a package the portal doesn't use", "packages/dotypos/src/index.ts"],
    ["a package sharing a name prefix", "packages/dotypos-extra/src/a.ts"],
  ])("keeps the skip when only %s changed", (_name, path) => {
    expect(decideRebuild([path], graph).rebuild).toBe(false);
  });

  test("rebuilds when any one of several changes reaches the portal", () => {
    expect(
      decideRebuild(
        [".agents/skills/example/SKILL.md", "apps/deskohub-portal/a.ts"],
        graph
      ).rebuild
    ).toBe(true);
  });

  test("keeps the skip when nothing changed", () => {
    expect(decideRebuild([], graph).rebuild).toBe(false);
  });
});

const deployment = (
  overrides: Partial<DeploymentSummary> & Pick<DeploymentSummary, "id">
): DeploymentSummary => ({
  created: 0,
  readyState: "READY",
  target: null,
  repositoryId: "1",
  ref: "feature",
  sha: "a".repeat(40),
  ...overrides,
});

describe("comparisonBase", () => {
  const skipped = deployment({
    id: "skipped",
    created: 100,
    readyState: "CANCELED",
  });

  test("uses the branch's newest ready preview before the skipped one", () => {
    expect(
      comparisonBase(skipped, [
        deployment({ id: "older", created: 10 }),
        deployment({ id: "newer", created: 50 }),
        deployment({ id: "after", created: 150 }),
        deployment({ id: "failed", created: 60, readyState: "ERROR" }),
        deployment({ id: "canceled", created: 70, readyState: "CANCELED" }),
        deployment({ id: "other-branch", created: 90, ref: "other" }),
        deployment({ id: "fork", created: 95, repositoryId: "2" }),
      ])?.id
    ).toBe("newer");
  });

  test("falls back to production for a branch without a ready preview", () => {
    expect(
      comparisonBase(skipped, [
        deployment({
          id: "production",
          created: 40,
          target: "production",
          ref: "main",
        }),
        deployment({ id: "preview-elsewhere", created: 80, ref: "other" }),
        deployment({
          id: "fork-production",
          created: 90,
          target: "production",
          repositoryId: "2",
        }),
      ])?.id
    ).toBe("production");
  });

  test("ignores ready deployments without a commit", () => {
    expect(
      comparisonBase(skipped, [
        deployment({ id: "cli", created: 50, sha: undefined }),
      ])
    ).toBeUndefined();
  });
});

describe("isSuperseded", () => {
  const skipped = deployment({ id: "skipped", created: 100 });

  test("is superseded by a newer preview of the same branch", () => {
    expect(
      isSuperseded(skipped, [deployment({ id: "next", created: 101 })])
    ).toBe(true);
  });

  test("isn't superseded by older deployments, other branches, forks or production", () => {
    expect(
      isSuperseded(skipped, [
        skipped,
        deployment({ id: "before", created: 99 }),
        deployment({ id: "other", created: 200, ref: "other" }),
        deployment({ id: "fork", created: 200, repositoryId: "2" }),
        deployment({ id: "production", created: 200, target: "production" }),
      ])
    ).toBe(false);
  });
});

describe("isRecoverableSkip", () => {
  test.each([
    [
      "a skipped preview",
      deployment({ id: "skipped", readyState: "CANCELED" }),
    ],
    [
      "a skipped production deployment",
      deployment({
        id: "production",
        readyState: "CANCELED",
        target: "production",
      }),
    ],
  ])("recovers %s", (_name, candidate) => {
    expect(isRecoverableSkip(candidate)).toBe(true);
  });

  test.each([
    ["a ready preview", deployment({ id: "ready" })],
    [
      "a building preview",
      deployment({ id: "building", readyState: "BUILDING" }),
    ],
    ["a failed preview", deployment({ id: "failed", readyState: "ERROR" })],
  ])("leaves %s alone", (_name, candidate) => {
    expect(isRecoverableSkip(candidate)).toBe(false);
  });
});

describe("recoverSkippedDeployment", () => {
  type Call = { kind: string; input: unknown };

  /** A fake Vercel project holding `existing`, recording what it is asked to do. */
  const fakeDeployments = (
    existing: readonly DeploymentSummary[],
    {
      truncatedNewer = false,
      newerAfterFirstCheck = [] as DeploymentSummary[],
    } = {}
  ) => {
    const calls: Call[] = [];
    let supersessionChecks = 0;
    const deployments: PortalDeployments = {
      list: async (query) => {
        calls.push({ kind: "list", input: query });
        const isNewerQuery = query.since !== undefined;
        if (isNewerQuery) supersessionChecks += 1;
        const pool = [
          ...existing,
          ...(isNewerQuery && supersessionChecks > 1
            ? newerAfterFirstCheck
            : []),
        ];
        return {
          deployments: pool.filter(
            (candidate) =>
              (query.branch === undefined || candidate.ref === query.branch) &&
              (query.target === undefined ||
                candidate.target === query.target) &&
              (query.state === undefined ||
                candidate.readyState === query.state) &&
              (query.since === undefined ||
                candidate.created > Number(query.since)) &&
              (query.until === undefined ||
                candidate.created < Number(query.until))
          ),
          truncated: isNewerQuery && truncatedNewer,
        };
      },
      redeploy: async (deploymentId) => {
        calls.push({ kind: "redeploy", input: deploymentId });
        return deployment({ id: `rebuilt-${deploymentId}`, created: 1000 });
      },
      deployBranchHeadToProduction: async (input) => {
        calls.push({ kind: "production", input });
        return deployment({
          id: "production-head",
          created: 1000,
          target: "production",
        });
      },
    };
    return { calls, deployments };
  };

  const rebuild = async () => ({ rebuild: true, reason: "portal changed" });
  const keep = async () => ({
    rebuild: false,
    reason: "nothing reaches the portal",
  });
  const deploys = (calls: readonly Call[]) =>
    calls.filter((call) => call.kind !== "list");

  const skippedPreview = deployment({
    id: "skipped",
    created: 100,
    readyState: "CANCELED",
  });
  const readyPreview = deployment({
    id: "ready",
    created: 50,
    sha: "b".repeat(40),
  });

  test("redeploys a skipped preview whose portal changed", async () => {
    const fake = fakeDeployments([readyPreview, skippedPreview]);
    const bases: (string | undefined)[] = [];
    const outcome = await recoverSkippedDeployment({
      skipped: skippedPreview,
      deployments: fake.deployments,
      decide: async (_head, base) => {
        bases.push(base?.id);
        return rebuild();
      },
      dryRun: false,
    });

    expect(outcome).toMatchObject({
      action: "deployed",
      deploymentId: "rebuilt-skipped",
    });
    expect(bases).toEqual(["ready"]);
    expect(deploys(fake.calls)).toEqual([
      { kind: "redeploy", input: "skipped" },
    ]);
  });

  test("deploys the production branch head for a skipped production deployment", async () => {
    const readyProduction = deployment({
      id: "ready-production",
      created: 40,
      target: "production",
      ref: "main",
      sha: "c".repeat(40),
    });
    const skippedProduction = deployment({
      id: "skipped-production",
      created: 100,
      readyState: "CANCELED",
      target: "production",
      ref: "main",
    });
    const fake = fakeDeployments([
      readyProduction,
      deployment({ id: "main-preview", created: 60, ref: "main" }),
      skippedProduction,
    ]);
    const bases: (string | undefined)[] = [];
    const outcome = await recoverSkippedDeployment({
      skipped: skippedProduction,
      deployments: fake.deployments,
      decide: async (_head, base) => {
        bases.push(base?.id);
        return rebuild();
      },
      dryRun: false,
    });

    expect(outcome).toMatchObject({
      action: "deployed",
      deploymentId: "production-head",
    });
    expect(bases).toEqual(["ready-production"]);
    expect(deploys(fake.calls)).toEqual([
      { kind: "production", input: { repositoryId: "1", ref: "main" } },
    ]);
  });

  test("deploys nothing when no change reaches the portal", async () => {
    const fake = fakeDeployments([readyPreview, skippedPreview]);
    const outcome = await recoverSkippedDeployment({
      skipped: skippedPreview,
      deployments: fake.deployments,
      decide: keep,
      dryRun: false,
    });

    expect(outcome.action).toBe("none");
    expect(deploys(fake.calls)).toEqual([]);
  });

  test("deploys nothing in a dry run", async () => {
    const fake = fakeDeployments([readyPreview, skippedPreview]);
    const outcome = await recoverSkippedDeployment({
      skipped: skippedPreview,
      deployments: fake.deployments,
      decide: rebuild,
      dryRun: true,
    });

    expect(outcome.action).toBe("none");
    expect(deploys(fake.calls)).toEqual([]);
  });

  test("leaves a deployment that wasn't skipped alone", async () => {
    const fake = fakeDeployments([readyPreview]);
    const outcome = await recoverSkippedDeployment({
      skipped: readyPreview,
      deployments: fake.deployments,
      decide: rebuild,
      dryRun: false,
    });

    expect(outcome.action).toBe("none");
    expect(fake.calls).toEqual([]);
  });

  test.each([
    [
      "a newer deployment of the branch exists",
      { existing: [deployment({ id: "newer", created: 150 })] },
    ],
    ["the newer deployments are truncated", { truncatedNewer: true }],
    [
      "a newer deployment appears while comparing",
      { newerAfterFirstCheck: [deployment({ id: "late", created: 150 })] },
    ],
  ])("deploys nothing when %s", async (_name, setup) => {
    const fake = fakeDeployments(
      [
        readyPreview,
        skippedPreview,
        ...("existing" in setup ? setup.existing : []),
      ],
      {
        truncatedNewer: "truncatedNewer" in setup && setup.truncatedNewer,
        newerAfterFirstCheck:
          "newerAfterFirstCheck" in setup ? setup.newerAfterFirstCheck : [],
      }
    );
    const outcome = await recoverSkippedDeployment({
      skipped: skippedPreview,
      deployments: fake.deployments,
      decide: rebuild,
      dryRun: false,
    });

    expect(outcome.action).toBe("none");
    expect(deploys(fake.calls)).toEqual([]);
  });

  test("ignores newer deployments of other branches, forks and targets", async () => {
    const fake = fakeDeployments([
      readyPreview,
      skippedPreview,
      deployment({ id: "fork", created: 150, repositoryId: "2" }),
      deployment({ id: "production", created: 150, target: "production" }),
    ]);
    const outcome = await recoverSkippedDeployment({
      skipped: skippedPreview,
      deployments: fake.deployments,
      decide: rebuild,
      dryRun: false,
    });

    expect(outcome.action).toBe("deployed");
  });

  test("rejects a skipped deployment without a Git commit", async () => {
    const fake = fakeDeployments([]);
    await expect(
      recoverSkippedDeployment({
        skipped: deployment({
          id: "cli",
          readyState: "CANCELED",
          sha: undefined,
        }),
        deployments: fake.deployments,
        decide: rebuild,
        dryRun: false,
      })
    ).rejects.toThrow("no Git commit");
  });
});

describe("changedPathsBetween", () => {
  const directories: string[] = [];
  afterEach(() => {
    for (const directory of directories.splice(0)) {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  const git = (cwd: string, ...args: string[]) => {
    const result = Bun.spawnSync(["git", ...args], {
      cwd,
      env: {
        GIT_AUTHOR_EMAIL: "rebuild-skipped-deployment-test",
        GIT_AUTHOR_NAME: "Test",
        GIT_COMMITTER_EMAIL: "rebuild-skipped-deployment-test",
        GIT_COMMITTER_NAME: "Test",
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_CONFIG_NOSYSTEM: "1",
        PATH: process.env.PATH ?? "",
      },
    });
    if (result.exitCode !== 0) throw new Error(result.stderr.toString());
    return result.stdout.toString().trim();
  };

  const commitFiles = (root: string, files: Record<string, string>) => {
    for (const [path, content] of Object.entries(files)) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), content);
    }
    git(root, "add", "--all");
    git(root, "commit", "--quiet", "--allow-empty", "-m", "change");
    return git(root, "rev-parse", "HEAD");
  };

  test("lists every file changed across several commits, including renames' sources", async () => {
    const root = mkdtempSync(join(tmpdir(), "portal-rebuild-"));
    directories.push(root);
    git(root, "init", "--quiet");
    const base = commitFiles(root, { "packages/x/a.ts": "a\n" });
    commitFiles(root, { "apps/deskohub-portal/b.ts": "b\n" });
    mkdirSync(join(root, ".agents"));
    git(root, "mv", "packages/x/a.ts", ".agents/a.ts");
    const head = commitFiles(root, { ".agents/c.md": "c\n" });

    expect(
      [...((await changedPathsBetween(base, head, root)) ?? [])].sort()
    ).toEqual([
      ".agents/a.ts",
      ".agents/c.md",
      "apps/deskohub-portal/b.ts",
      "packages/x/a.ts",
    ]);
  });

  test("can't tell when the base commit is unknown", async () => {
    const root = mkdtempSync(join(tmpdir(), "portal-rebuild-"));
    directories.push(root);
    git(root, "init", "--quiet");
    const head = commitFiles(root, { "a.ts": "a\n" });

    expect(
      await changedPathsBetween(
        "0123456789abcdef0123456789abcdef01234567",
        head,
        root
      )
    ).toBeUndefined();
  });
});

test("reads the portal's packages from the repository's package graph", async () => {
  const repositoryGraph = await readPackageGraph(
    join(import.meta.dir, "../../..")
  );

  expect(repositoryGraph.packagePaths).toContain(".agents");
  expect(repositoryGraph.portalPackagePaths).toContain("apps/deskohub-portal");
  expect(repositoryGraph.portalPackagePaths).not.toContain(".agents");
  for (const path of repositoryGraph.portalPackagePaths) {
    expect(repositoryGraph.packagePaths).toContain(path);
  }
});
