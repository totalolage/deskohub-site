import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { commandOutput, runCommand } from "./shared/command";
import {
  parseShard,
  prepareShard,
  requirePinnedBun,
  shardDatabaseUrl,
  shardEnvironment,
  shardTestArguments,
  shardTimingsRecording,
  shardTimingsRecordingPattern,
  testShardCount,
  workspaceTestArguments,
} from "./test-shard";

const workspaceRoot = resolve(import.meta.dir, "..");
const repositoryRoot = resolve(workspaceRoot, "../..");

interface TurboTask {
  readonly cache?: boolean;
  readonly dependsOn?: readonly string[];
  readonly env?: readonly string[];
  readonly inputs?: readonly string[];
  readonly outputs?: readonly string[];
  readonly passThroughEnv?: readonly string[];
}

interface TurboConfig {
  readonly globalPassThroughEnv?: readonly string[];
  readonly tasks: Readonly<Record<string, TurboTask>>;
}

const readJson = async <T>(path: string): Promise<T> =>
  JSON.parse(await readFile(path, "utf8")) as T;

const workspaceTurbo = await readJson<TurboConfig>(
  join(workspaceRoot, "turbo.json")
);
const rootTurbo = await readJson<TurboConfig>(
  join(repositoryRoot, "turbo.json")
);
const workspacePackage = await readJson<{
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly devDependencies?: Readonly<Record<string, string>>;
  readonly scripts: Readonly<Record<string, string>>;
}>(join(workspaceRoot, "package.json"));
const mobilePackage = "deskohub-mobile";
const rootPackage = await readJson<{ readonly packageManager: string }>(
  join(repositoryRoot, "package.json")
);

const shards = Array.from({ length: testShardCount }, (_, index) => index + 1);
const shardTask = (shard: number): TurboTask => {
  const task = workspaceTurbo.tasks[`test:shard-${shard}`];
  expect(task).toBeDefined();
  return task as TurboTask;
};

const synthetic = "postgresql://synthetic:synthetic@127.0.0.1:1/synthetic";

describe("shard arguments", () => {
  test("accepts only the configured shard numbers", () => {
    expect(shards.map((shard) => parseShard(String(shard)))).toEqual(shards);
    for (const argument of [undefined, "", "0", "5", "1.5", "x"]) {
      expect(() => parseShard(argument)).toThrow("Expected a shard number");
    }
  });

  test("balances by the committed timings and records into the shard's own file first", () => {
    const shardArguments = shardTestArguments(2);
    const timings = shardArguments.filter((argument) =>
      argument.startsWith("--timings=")
    );
    // --update-timings writes the first --timings file; the committed file
    // must never be it.
    expect(timings).toEqual([
      `--timings=./${shardTimingsRecording(2)}`,
      "--timings=./test-timings.json",
    ]);
    expect(shardArguments).toContain("--update-timings");
    expect(shardArguments).toContain(`--shard=2/${testShardCount}`);
    expect(shardArguments).toContain("--no-env-file");
    expect(shardArguments.slice(0, workspaceTestArguments.length + 1)).toEqual([
      "test",
      ...workspaceTestArguments,
    ]);
    expect(
      new Bun.Glob(shardTimingsRecordingPattern).match(shardTimingsRecording(3))
    ).toBe(true);
  });

  test("runs the same bun test arguments as the package test script", async () => {
    // Bash splits the script the way the package script runner does.
    const script = workspacePackage.scripts.test ?? "";
    const words = (
      await commandOutput(["bash", "-c", `printf '%s\\0' ${script}`], {
        timeoutMs: 5000,
      })
    )
      .split("\0")
      .filter(Boolean);
    expect(words).toEqual(["bun", "test", ...workspaceTestArguments]);
  });
});

describe("shard preconditions", () => {
  test("prefers the shard's own database and falls back to the CI one", () => {
    expect(
      shardDatabaseUrl(3, {
        WORKSPACE_TEST_DATABASE_URL: "ci",
        WORKSPACE_TEST_DATABASE_URL_SHARD_3: "local",
      })
    ).toBe("local");
    expect(shardDatabaseUrl(3, { WORKSPACE_TEST_DATABASE_URL: "ci" })).toBe(
      "ci"
    );
  });

  test("refuses to run, and so to cache, a shard without a database", () => {
    for (const environment of [
      {},
      { WORKSPACE_TEST_DATABASE_URL: "" },
      { WORKSPACE_TEST_DATABASE_URL_SHARD_2: synthetic },
    ]) {
      expect(() => shardDatabaseUrl(1, environment)).toThrow(
        "needs a disposable test database"
      );
    }
  });

  test("gives the tests only hashed or location variables and the database", () => {
    expect(
      shardEnvironment(
        {
          BUN_OPTIONS: "--preload ./coverage.ts",
          CI: "true",
          DATABASE_URL: "postgresql://runtime",
          DOTYPOS_API_URL: "https://dotypos.example",
          HOME: "/home/synthetic",
          PATH: "/usr/bin",
          TZ: "UTC",
          WORKSPACE_TEST_DATABASE_URL_SHARD_1: synthetic,
        },
        synthetic
      )
    ).toEqual({
      CI: "true",
      HOME: "/home/synthetic",
      PATH: "/usr/bin",
      TZ: "UTC",
      WORKSPACE_TEST_DATABASE_URL: synthetic,
    });
  });

  test("runs only under the pinned Bun", () => {
    expect(() => requirePinnedBun("bun@1.4.2", "1.4.2")).not.toThrow();
    expect(() => requirePinnedBun("bun@1.4.2", "1.4.3")).toThrow(
      "pinned bun@1.4.2"
    );
    expect(() => requirePinnedBun("npm@11.0.0", "1.4.2")).toThrow();
    expect(() =>
      requirePinnedBun(rootPackage.packageManager, Bun.version)
    ).not.toThrow();
  });

  test("deletes a leftover recording before the shard runs", async () => {
    const directory = await mkdtemp(join(tmpdir(), "workspace-test-shard-"));
    try {
      const recording = join(directory, shardTimingsRecording(4));
      await writeFile(recording, '{"version":1,"files":{}}\n');
      const prepared = await prepareShard(
        "4",
        { PATH: "/usr/bin", WORKSPACE_TEST_DATABASE_URL: synthetic },
        directory
      );
      expect(existsSync(recording)).toBe(false);
      expect(prepared.command).toEqual([
        process.execPath,
        ...shardTestArguments(4),
      ]);
      expect(prepared.environment).toEqual({
        PATH: "/usr/bin",
        WORKSPACE_TEST_DATABASE_URL: synthetic,
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("keeps a leftover recording when the shard cannot run", async () => {
    const directory = await mkdtemp(join(tmpdir(), "workspace-test-shard-"));
    try {
      const recording = join(directory, shardTimingsRecording(1));
      await writeFile(recording, '{"version":1,"files":{}}\n');
      const failure = await prepareShard("1", {}, directory).then(
        () => undefined,
        (cause: unknown) => cause
      );
      expect(String(failure)).toContain("needs a disposable test database");
      expect(existsSync(recording)).toBe(true);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("exits non-zero from the package script without a database", async () => {
    const result = await runCommand(
      ["bun", "--no-env-file", "scripts/test-shard.ts", "1"],
      {
        cwd: workspaceRoot,
        env: { HOME: process.env.HOME, PATH: process.env.PATH },
        timeoutMs: 20_000,
      }
    );
    expect(result.timedOut).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("needs a disposable test database");
  });
});

describe("cached shard tasks", () => {
  test("defines one package script and Turbo task per shard", () => {
    for (const shard of shards) {
      expect(workspacePackage.scripts[`test:shard-${shard}`]).toBe(
        `bun --no-env-file scripts/test-shard.ts ${shard}`
      );
      expect(shardTask(shard).cache).not.toBe(false);
    }
    expect(
      Object.keys(workspaceTurbo.tasks).filter((name) =>
        name.startsWith("test:shard-")
      )
    ).toEqual(shards.map((shard) => `test:shard-${shard}`));
    // The unsharded suite and coverage keep running uncached.
    expect(workspaceTurbo.tasks.test?.cache).toBe(false);
  });

  test("restores each shard's recording and passes its database through unhashed", () => {
    for (const shard of shards) {
      const task = shardTask(shard);
      expect(task.outputs).toEqual([shardTimingsRecording(shard)]);
      expect(task.passThroughEnv).toEqual([
        "WORKSPACE_TEST_DATABASE_URL",
        `WORKSPACE_TEST_DATABASE_URL_SHARD_${shard}`,
      ]);
    }
  });

  test("hashes the same inputs, environment, and prerequisites for every shard", () => {
    const [first, ...rest] = shards.map(shardTask);
    for (const task of rest) {
      expect(task.inputs).toEqual(first?.inputs);
      expect(task.env).toEqual(first?.env);
      expect(task.dependsOn).toEqual(first?.dependsOn);
    }
    expect(first?.env).toEqual(["CI", "TZ"]);
    // Recordings are outputs, never inputs.
    expect(first?.inputs).toContain(`!${shardTimingsRecordingPattern}`);
    // The shard needs every prerequisite the unsharded suite has, with the
    // internal packages' tests (^test there) taken from test:dependencies.
    const testPrerequisites = (workspaceTurbo.tasks.test?.dependsOn ?? []).map(
      (dependency) =>
        dependency === "$TURBO_EXTENDS$" ? "test:dependencies" : dependency
    );
    expect([...(first?.dependsOn ?? [])].sort()).toEqual(
      [...testPrerequisites].sort()
    );
  });

  test("depends on the tests of every internal package but Mobile", () => {
    // Internal packages reach the shard hash only through these task edges.
    // Mobile is a dependency only so its changes redeploy the Workspace,
    // which serves its web export; Workspace tests import none of it, read
    // only the Mobile files the shard inputs list, and Workspace validation
    // runs Mobile's tests on every pull request.
    const internalPackages = Object.entries({
      ...workspacePackage.dependencies,
      ...workspacePackage.devDependencies,
    })
      .filter(([, version]) => version.startsWith("workspace:"))
      .map(([name]) => name);
    expect(internalPackages).toContain(mobilePackage);
    const dependencies = workspaceTurbo.tasks["test:dependencies"];
    expect(dependencies?.dependsOn).toEqual(
      internalPackages
        .filter((name) => name !== mobilePackage)
        .sort()
        .map((name) => `${name}#test`)
    );
    // A script would run in every shard job; the task only collects edges.
    expect(workspacePackage.scripts["test:dependencies"]).toBeUndefined();
    expect(dependencies?.inputs).toEqual([]);
  });

  test("hashes CI and TZ for the package tests the shards depend on, and keeps TMPDIR in strict mode", () => {
    expect(rootTurbo.tasks.test?.env).toEqual(["CI", "TZ"]);
    expect(rootTurbo.globalPassThroughEnv).toContain("TMPDIR");
  });
});

/**
 * The repository files git reports for these pathspecs, tracked or
 * untracked but not ignored, that no shard input hashes.
 */
const unhashedRepositoryFiles = async (
  pathspecs: ReadonlyArray<string>
): Promise<{ readonly files: number; readonly unhashed: string[] }> => {
  const rootInputs = (shardTask(1).inputs ?? [])
    .filter((input) => input.startsWith("$TURBO_ROOT$/"))
    .map((input) => new Bun.Glob(input.slice("$TURBO_ROOT$/".length)));
  const files = (
    await commandOutput(
      [
        "git",
        "ls-files",
        "--cached",
        "--others",
        "--exclude-standard",
        "--",
        ...pathspecs,
      ],
      { cwd: repositoryRoot, timeoutMs: 20_000 }
    )
  )
    .split("\n")
    .filter(Boolean);
  const workspaceDirectory = relative(repositoryRoot, workspaceRoot);
  return {
    files: files.length,
    unhashed: files.filter(
      (file) =>
        !file.startsWith(`${workspaceDirectory}/`) &&
        !rootInputs.some((glob) => glob.match(file))
    ),
  };
};

// Workspace CI also runs this file outside Turbo: a file these checks would
// reject changes no shard hash, so a cached shard would replay their pass.
describe("shard inputs outside the package", () => {
  const ignore = workspaceTestArguments
    .find((argument) => argument.startsWith("--path-ignore-patterns="))
    ?.slice("--path-ignore-patterns=".length);
  const ignored = new Bun.Glob(ignore ?? "");

  test("leave the repository-wide tests to uncached Workspace validation", () => {
    // A *.repository-wide.test.ts reads files across the repository (every test
    // file, every scanned module), so no package task may cache it.
    expect(
      ignored.match("scripts/no-source-string-tests.repository-wide.test.ts")
    ).toBe(true);
    expect(
      ignored.match(
        "features/administration/i18n/administration-messages.build.test.ts"
      )
    ).toBe(true);
    expect(ignored.match("scripts/test-shard.test.ts")).toBe(false);
  });

  test("skip only the tests another Workspace CI step runs", async () => {
    // An ignore pattern that also matched ordinary tests (the database
    // *.repository.test.ts suites, say) would drop them from every shard.
    const listed = (
      await commandOutput(
        [
          "git",
          "ls-files",
          "--cached",
          "--others",
          "--exclude-standard",
          "--",
          "*.test.ts",
          "*.test.tsx",
        ],
        { cwd: workspaceRoot, timeoutMs: 20_000 }
      )
    )
      .split("\n")
      .filter(Boolean);
    const buildOutput = workspacePackage.scripts["test:build-output"] ?? "";
    const skipped = listed.filter((file) => ignored.match(file));
    expect(skipped.length).toBeGreaterThan(0);
    expect(
      skipped.filter(
        (file) =>
          !buildOutput.split(" ").includes(`./${file}`) &&
          !file.endsWith(".repository-wide.test.ts")
      )
    ).toEqual([]);
    expect(listed).toContain(
      "features/checkout/backend/repositories/webhook-event.repository.test.ts"
    );
  });

  test("hash every ignore file that decides which files the package's own scans see", async () => {
    const { files, unhashed } = await unhashedRepositoryFiles([
      ":(glob)**/.gitignore",
    ]);
    expect(files).toBeGreaterThan(0);
    expect(unhashed).toEqual([]);
  });
});
