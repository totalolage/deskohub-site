import { afterEach, describe, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const portalDirectory = join(import.meta.dir, "..");
const repositoryRoot = join(portalDirectory, "../..");
const script = join(import.meta.dir, "ignored-build-step.sh");

const BUILD = 1;
const SKIP = 0;

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

const temporaryDirectory = () => {
  const directory = mkdtempSync(join(tmpdir(), "portal-ignored-build-"));
  temporaryDirectories.push(directory);
  return directory;
};

const gitEnvironment = {
  GIT_AUTHOR_EMAIL: "ignored-build-step-test",
  GIT_AUTHOR_NAME: "Test",
  GIT_COMMITTER_EMAIL: "ignored-build-step-test",
  GIT_COMMITTER_NAME: "Test",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  PATH: process.env.PATH ?? "",
};

const run = (command: string[], cwd: string) => {
  const result = Bun.spawnSync(command, { cwd, env: gitEnvironment });
  if (result.exitCode !== 0) {
    throw new Error(`${command.join(" ")} failed: ${result.stderr.toString()}`);
  }
  return result.stdout.toString().trim();
};

const writeFiles = (root: string, files: Record<string, string>) => {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
};

/** A repository shaped like the monorepo, with one commit. */
const createRepository = () => {
  const root = temporaryDirectory();
  run(["git", "init", "--quiet", "--initial-branch=main"], root);
  writeFiles(root, {
    ".agents/skills/example/SKILL.md": "skill\n",
    ".github/workflows/ci.yml": "name: CI\n",
    ".vercelignore": ".next\n",
    "apps/deskohub-portal/package.json": "{}\n",
    "apps/deskohub-portal/src/pages/index.astro": "<h1>Portal</h1>\n",
    "apps/deskohub-portal/vercel.json": "{}\n",
    "apps/deskohub-workspace/app/page.tsx": "export default 1;\n",
    "apps/deskohub-workspace/package.json": "{}\n",
    "biome.json": "{}\n",
    "bun.lock": "{}\n",
    "package.json": "{}\n",
    "packages/dotypos/package.json": "{}\n",
    "packages/dotypos/src/index.ts": "export {};\n",
    "patches/example.patch": "patch\n",
    "tsconfig.json": "{}\n",
    "turbo.json": "{}\n",
  });
  return root;
};

const commit = (root: string, message = "change") => {
  run(["git", "add", "--all"], root);
  run(["git", "commit", "--quiet", "--allow-empty", "-m", message], root);
  return run(["git", "rev-parse", "HEAD"], root);
};

const head = (root: string) => run(["git", "rev-parse", "HEAD"], root);

const ignoredBuildStep = (
  root: string,
  environment: Record<string, string | undefined>
) => {
  const result = Bun.spawnSync(["bash", script], {
    cwd: join(root, "apps/deskohub-portal"),
    env: { ...gitEnvironment, VERCEL_ENV: "preview", ...environment },
  });
  return { exitCode: result.exitCode, output: result.stdout.toString() };
};

/** Commits `files` on top of a base commit and runs the step for the pair. */
const decisionFor = (files: Record<string, string>) => {
  const root = createRepository();
  const previous = commit(root, "base");
  writeFiles(root, files);
  const current = commit(root);
  return ignoredBuildStep(root, {
    VERCEL_GIT_COMMIT_SHA: current,
    VERCEL_GIT_PREVIOUS_SHA: previous,
  }).exitCode;
};

describe("portal ignored build step", () => {
  test.each([
    ["portal source", "apps/deskohub-portal/src/pages/index.astro"],
    ["portal Vercel configuration", "apps/deskohub-portal/vercel.json"],
    ["portal manifest", "apps/deskohub-portal/package.json"],
    ["lockfile", "bun.lock"],
    ["root manifest", "package.json"],
    ["workspace manifest", "apps/deskohub-workspace/package.json"],
    ["package manifest", "packages/dotypos/package.json"],
    ["patch", "patches/example.patch"],
    ["root Turbo configuration", "turbo.json"],
    ["root TypeScript configuration", "tsconfig.json"],
    ["Vercel ignore file", ".vercelignore"],
    ["Bun configuration", "bunfig.toml"],
    ["new root Vercel configuration", "vercel.json"],
    ["unknown root file", "new-root-file.txt"],
    ["unknown root directory", "tools/build.ts"],
  ])("builds when the %s changes", (_name, path) => {
    expect(decisionFor({ [path]: `changed ${path}\n` })).toBe(BUILD);
  });

  test.each([
    ["agent skills", ".agents/skills/example/SKILL.md"],
    ["GitHub workflows", ".github/workflows/ci.yml"],
    ["workspace source", "apps/deskohub-workspace/app/page.tsx"],
    ["shared package source", "packages/dotypos/src/index.ts"],
    ["repository lint rules", "lint/rule.ts"],
    ["Biome configuration", "biome.json"],
  ])("skips when only %s change", (_name, path) => {
    expect(decisionFor({ [path]: `changed ${path}\n` })).toBe(SKIP);
  });

  test("builds when an unrelated change comes with a lockfile change", () => {
    expect(
      decisionFor({
        ".agents/skills/example/SKILL.md": "changed\n",
        "bun.lock": "changed\n",
      })
    ).toBe(BUILD);
  });

  test("builds when a file moves into the portal", () => {
    const root = createRepository();
    const previous = commit(root, "base");
    run(
      [
        "git",
        "mv",
        "packages/dotypos/src/index.ts",
        "apps/deskohub-portal/src/moved.ts",
      ],
      root
    );
    const current = commit(root);
    expect(
      ignoredBuildStep(root, {
        VERCEL_GIT_COMMIT_SHA: current,
        VERCEL_GIT_PREVIOUS_SHA: previous,
      }).exitCode
    ).toBe(BUILD);
  });

  test("builds when a portal file is deleted", () => {
    const root = createRepository();
    const previous = commit(root, "base");
    rmSync(join(root, "apps/deskohub-portal/vercel.json"));
    const current = commit(root);
    expect(
      ignoredBuildStep(root, {
        VERCEL_GIT_COMMIT_SHA: current,
        VERCEL_GIT_PREVIOUS_SHA: previous,
      }).exitCode
    ).toBe(BUILD);
  });

  test("compares against the previous deployment across several commits", () => {
    const root = createRepository();
    const previous = commit(root, "base");
    writeFiles(root, { "bun.lock": "changed\n" });
    commit(root, "lockfile");
    writeFiles(root, { ".agents/skills/example/SKILL.md": "changed\n" });
    const current = commit(root, "skill");
    expect(
      ignoredBuildStep(root, {
        VERCEL_GIT_COMMIT_SHA: current,
        VERCEL_GIT_PREVIOUS_SHA: previous,
      }).exitCode
    ).toBe(BUILD);
  });

  test("skips production deployments with only unrelated changes", () => {
    const root = createRepository();
    const previous = commit(root, "base");
    writeFiles(root, { "apps/deskohub-workspace/app/page.tsx": "changed\n" });
    const current = commit(root);
    const result = ignoredBuildStep(root, {
      VERCEL_ENV: "production",
      VERCEL_GIT_COMMIT_SHA: current,
      VERCEL_GIT_PREVIOUS_SHA: previous,
    });
    expect(result.exitCode).toBe(SKIP);
    expect(result.output).toContain(previous);
  });

  test("builds production deployments with portal changes", () => {
    const root = createRepository();
    const previous = commit(root, "base");
    writeFiles(root, { "apps/deskohub-portal/src/pages/index.astro": "new\n" });
    const current = commit(root);
    expect(
      ignoredBuildStep(root, {
        VERCEL_ENV: "production",
        VERCEL_GIT_COMMIT_SHA: current,
        VERCEL_GIT_PREVIOUS_SHA: previous,
      }).exitCode
    ).toBe(BUILD);
  });

  test("builds without a previous deployment on the branch", () => {
    const root = createRepository();
    const current = commit(root, "base");
    expect(
      ignoredBuildStep(root, {
        VERCEL_GIT_COMMIT_SHA: current,
        VERCEL_GIT_PREVIOUS_SHA: undefined,
      }).exitCode
    ).toBe(BUILD);
    expect(
      ignoredBuildStep(root, {
        VERCEL_GIT_COMMIT_SHA: current,
        VERCEL_GIT_PREVIOUS_SHA: "",
      }).exitCode
    ).toBe(BUILD);
  });

  test.each([
    ["an abbreviated hash", (sha: string) => sha.slice(0, 12)],
    ["a revision expression", () => "HEAD~1"],
    ["an uppercase hash", (sha: string) => sha.toUpperCase()],
  ])("builds when the previous commit is %s", (_name, format) => {
    const root = createRepository();
    const previous = commit(root, "base");
    writeFiles(root, { ".agents/skills/example/SKILL.md": "changed\n" });
    const current = commit(root);
    expect(
      ignoredBuildStep(root, {
        VERCEL_GIT_COMMIT_SHA: current,
        VERCEL_GIT_PREVIOUS_SHA: format(previous),
      }).exitCode
    ).toBe(BUILD);
  });

  test("builds when the previous commit is not in the repository", () => {
    const root = createRepository();
    commit(root, "base");
    writeFiles(root, { ".agents/skills/example/SKILL.md": "changed\n" });
    const current = commit(root);
    expect(
      ignoredBuildStep(root, {
        VERCEL_GIT_COMMIT_SHA: current,
        VERCEL_GIT_PREVIOUS_SHA: "0123456789abcdef0123456789abcdef01234567",
      }).exitCode
    ).toBe(BUILD);
  });

  test("builds when the previous commit is outside a shallow clone", () => {
    const origin = createRepository();
    const previous = commit(origin, "base");
    for (let index = 0; index < 3; index += 1) {
      writeFiles(origin, { [`.agents/note-${index}.md`]: `${index}\n` });
      commit(origin, `note ${index}`);
    }
    const clone = join(temporaryDirectory(), "clone");
    run(
      ["git", "clone", "--quiet", "--depth=2", `file://${origin}`, clone],
      origin
    );
    expect(
      ignoredBuildStep(clone, {
        VERCEL_GIT_COMMIT_SHA: head(clone),
        VERCEL_GIT_PREVIOUS_SHA: previous,
      }).exitCode
    ).toBe(BUILD);
  });

  test("skips within a shallow clone that contains the previous commit", () => {
    const origin = createRepository();
    commit(origin, "base");
    writeFiles(origin, { ".agents/first.md": "first\n" });
    const previous = commit(origin, "first");
    writeFiles(origin, { ".agents/second.md": "second\n" });
    commit(origin, "second");
    const clone = join(temporaryDirectory(), "clone");
    run(
      ["git", "clone", "--quiet", "--depth=2", `file://${origin}`, clone],
      origin
    );
    expect(
      ignoredBuildStep(clone, {
        VERCEL_GIT_COMMIT_SHA: head(clone),
        VERCEL_GIT_PREVIOUS_SHA: previous,
      }).exitCode
    ).toBe(SKIP);
  });

  test("builds when the previous commit is not an ancestor", () => {
    const root = createRepository();
    commit(root, "base");
    run(["git", "checkout", "--quiet", "-b", "other"], root);
    writeFiles(root, { ".agents/other.md": "other\n" });
    const previous = commit(root, "other branch");
    run(["git", "checkout", "--quiet", "main"], root);
    writeFiles(root, { ".agents/main.md": "main\n" });
    const current = commit(root, "main branch");
    expect(
      ignoredBuildStep(root, {
        VERCEL_GIT_COMMIT_SHA: current,
        VERCEL_GIT_PREVIOUS_SHA: previous,
      }).exitCode
    ).toBe(BUILD);
  });

  test("builds an older commit redeployed after a newer one", () => {
    const root = createRepository();
    const older = commit(root, "base");
    writeFiles(root, { ".agents/newer.md": "newer\n" });
    const newer = commit(root, "newer");
    run(["git", "checkout", "--quiet", older], root);
    expect(
      ignoredBuildStep(root, {
        VERCEL_GIT_COMMIT_SHA: older,
        VERCEL_GIT_PREVIOUS_SHA: newer,
      }).exitCode
    ).toBe(BUILD);
  });

  test("builds a redeploy of the same commit", () => {
    const root = createRepository();
    const current = commit(root, "base");
    expect(
      ignoredBuildStep(root, {
        VERCEL_GIT_COMMIT_SHA: current,
        VERCEL_GIT_PREVIOUS_SHA: current,
      }).exitCode
    ).toBe(BUILD);
  });

  test("builds an empty commit pushed to request a redeploy", () => {
    const root = createRepository();
    const previous = commit(root, "base");
    const current = commit(root, "redeploy");
    expect(
      ignoredBuildStep(root, {
        VERCEL_GIT_COMMIT_SHA: current,
        VERCEL_GIT_PREVIOUS_SHA: previous,
      }).exitCode
    ).toBe(BUILD);
  });

  test("builds when HEAD is not the deployment commit", () => {
    const root = createRepository();
    const previous = commit(root, "base");
    writeFiles(root, { ".agents/skills/example/SKILL.md": "changed\n" });
    commit(root);
    expect(
      ignoredBuildStep(root, {
        VERCEL_GIT_COMMIT_SHA: previous,
        VERCEL_GIT_PREVIOUS_SHA: previous,
      }).exitCode
    ).toBe(BUILD);
  });

  test("builds when Git is unavailable or fails", () => {
    const root = createRepository();
    const previous = commit(root, "base");
    writeFiles(root, { ".agents/skills/example/SKILL.md": "changed\n" });
    const current = commit(root);
    const environment = {
      VERCEL_GIT_COMMIT_SHA: current,
      VERCEL_GIT_PREVIOUS_SHA: previous,
    };

    expect(ignoredBuildStep(root, environment).exitCode).toBe(SKIP);
    expect(
      ignoredBuildStep(root, { ...environment, GIT_DIR: join(root, "missing") })
        .exitCode
    ).toBe(BUILD);

    rmSync(join(root, ".git/objects", previous.slice(0, 2)), {
      force: true,
      recursive: true,
    });
    expect(ignoredBuildStep(root, environment).exitCode).toBe(BUILD);
  });

  test("builds outside a Git checkout", () => {
    const directory = temporaryDirectory();
    mkdirSync(join(directory, "apps/deskohub-portal"), { recursive: true });
    expect(
      ignoredBuildStep(directory, {
        GIT_CEILING_DIRECTORIES: directory,
        VERCEL_GIT_COMMIT_SHA: "0123456789abcdef0123456789abcdef01234567",
        VERCEL_GIT_PREVIOUS_SHA: "89abcdef0123456789abcdef0123456789abcdef",
      }).exitCode
    ).toBe(BUILD);
  });
});

describe("portal ignored build step configuration", () => {
  test("the configured command decides from the portal directory", () => {
    const { ignoreCommand } = JSON.parse(
      readFileSync(join(portalDirectory, "vercel.json"), "utf8")
    );
    const root = createRepository();
    writeFiles(root, {
      "apps/deskohub-portal/scripts/ignored-build-step.sh": readFileSync(
        script,
        "utf8"
      ),
    });
    const configuredDecision = (files: Record<string, string>) => {
      const previous = commit(root, "base");
      writeFiles(root, files);
      const current = commit(root);
      return Bun.spawnSync(["bash", "-c", ignoreCommand], {
        cwd: join(root, "apps/deskohub-portal"),
        env: {
          ...gitEnvironment,
          VERCEL_GIT_COMMIT_SHA: current,
          VERCEL_GIT_PREVIOUS_SHA: previous,
        },
      }).exitCode;
    };

    expect(configuredDecision({ ".agents/note.md": "note\n" })).toBe(SKIP);
    expect(
      configuredDecision({ "apps/deskohub-portal/src/pages/index.astro": "x\n" })
    ).toBe(BUILD);
  });

  // The step treats other apps' and packages' sources as unrelated. Adding a
  // workspace dependency to the portal must update the step's path rules.
  test("the portal depends on no workspace package", () => {
    const workspacePackageNames = ["apps", "packages"].flatMap((parent) =>
      readdirSync(join(repositoryRoot, parent), { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .flatMap((entry) => {
          try {
            const manifest = JSON.parse(
              readFileSync(
                join(repositoryRoot, parent, entry.name, "package.json"),
                "utf8"
              )
            );
            return typeof manifest.name === "string" ? [manifest.name] : [];
          } catch {
            return [];
          }
        })
    );
    const portalManifest = JSON.parse(
      readFileSync(join(portalDirectory, "package.json"), "utf8")
    );
    const portalDependencies = [
      "dependencies",
      "devDependencies",
      "optionalDependencies",
      "peerDependencies",
    ].flatMap((field) => Object.keys(portalManifest[field] ?? {}));

    expect(workspacePackageNames.length).toBeGreaterThan(1);
    expect(
      portalDependencies.filter((name) => workspacePackageNames.includes(name))
    ).toEqual([]);
    expect(JSON.stringify(portalManifest)).not.toContain("workspace:");
  });
});
