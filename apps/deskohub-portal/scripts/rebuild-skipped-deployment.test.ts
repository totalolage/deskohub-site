import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  changedPathsBetween,
  comparisonBase,
  type DeploymentSummary,
  decideRebuild,
  isSuperseded,
  readPackageGraph,
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

  test("uses the branch's newest ready deployment before the skipped one", () => {
    expect(
      comparisonBase(skipped, [
        deployment({ id: "older", created: 10 }),
        deployment({ id: "newer", created: 50 }),
        deployment({ id: "after", created: 150 }),
        deployment({ id: "failed", created: 60, readyState: "ERROR" }),
        deployment({ id: "canceled", created: 70, readyState: "CANCELED" }),
        deployment({ id: "other-branch", created: 90, ref: "other" }),
      ])?.id
    ).toBe("newer");
  });

  test("falls back to production for a branch without a ready deployment", () => {
    expect(
      comparisonBase(skipped, [
        deployment({
          id: "production",
          created: 40,
          target: "production",
          ref: "main",
        }),
        deployment({ id: "preview-elsewhere", created: 80, ref: "other" }),
      ])?.id
    ).toBe("production");
  });

  test("finds nothing for production without an earlier ready production deployment", () => {
    const skippedProduction = deployment({
      id: "skipped",
      created: 100,
      readyState: "CANCELED",
      target: "production",
      ref: "main",
    });
    expect(
      comparisonBase(skippedProduction, [
        deployment({ id: "preview", created: 40, ref: "feature" }),
      ])
    ).toBeUndefined();
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

  test("is superseded by a newer deployment of the same branch", () => {
    expect(
      isSuperseded(skipped, [deployment({ id: "next", created: 101 })])
    ).toBe(true);
  });

  test("isn't superseded by older deployments or other branches", () => {
    expect(
      isSuperseded(skipped, [
        skipped,
        deployment({ id: "before", created: 99 }),
        deployment({ id: "other", created: 200, ref: "other" }),
      ])
    ).toBe(false);
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
