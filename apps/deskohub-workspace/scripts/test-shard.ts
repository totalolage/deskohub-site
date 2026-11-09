import { rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import rootPackage from "../../../package.json";
import { runCommand } from "./shared/command";

/**
 * Runs one of the Workspace test shards that the cached Turbo tasks
 * `test:shard-1` … `test:shard-4` execute, in CI and on a developer machine
 * alike. Turbo replays a passing shard from its cache whenever the task's
 * inputs match, so everything that can change the outcome either reaches
 * the hash or is held fixed here:
 *
 * - Bun cuts shards by the committed `test-timings.json` alone. Bun merges
 *   every `--timings` file and writes `--update-timings` into the first, so
 *   this shard's recording goes first and is deleted beforehand: a leftover
 *   one would move files between shards without changing the hash.
 * - The disposable database URL is passed through unhashed, and database
 *   suites skip without it, so a shard without one fails instead of caching
 *   a pass that never ran them.
 * - The tests see only the environment listed in `shardEnvironmentNames`.
 *   Turbo's strict mode still passes the root `globalPassThroughEnv`
 *   (runtime configuration and secrets) unhashed, and the test preload only
 *   fills in values that are missing.
 * - `.env` files are git-ignored and unhashed, so Bun's automatic loading is
 *   off for both this process (its package script) and the tests, which it
 *   starts directly rather than through another `bun run`.
 *
 * The launchers set `CI=true` and `TZ=UTC` before Turbo, so the hashed
 * values match on every machine; see `.github/workflows/workspace-tests.yml`
 * and `local-test-shards.ts`.
 */

/** Bun's shard count; the CI matrix, Turbo tasks, and package scripts match it. */
export const testShardCount = 4;

const workspaceRoot = resolve(import.meta.dir, "..");

/** Where a shard writes its measured durations, beside the package root. */
export const shardTimingsRecording = (shard: number): string =>
  `test-timings.shard-${shard}.json`;

/** Matches every shard's recording. */
export const shardTimingsRecordingPattern = "test-timings.shard-*.json";

/**
 * The variables a shard's tests receive. Turbo hashes `CI` (it decides
 * whether a missing Chromium fails or skips the browser suites, and puts Bun
 * in CI mode), `TZ`, `NODE_ENV`, and `VERCEL_ENV`; `GITHUB_ACTIONS` only adds
 * annotations; the rest are locations.
 */
export const shardEnvironmentNames = [
  "CI",
  "GITHUB_ACTIONS",
  "HOME",
  "NODE_ENV",
  "PATH",
  "SHELL",
  "TMPDIR",
  "TZ",
  "USER",
  "VERCEL_ENV",
] as const;

/** Reads a shard number from the command line. */
export const parseShard = (argument: string | undefined): number => {
  const shard = Number(argument);
  if (!(Number.isInteger(shard) && shard >= 1 && shard <= testShardCount)) {
    throw new Error(
      `Expected a shard number from 1 to ${testShardCount}, got ${argument ?? "nothing"}.`
    );
  }
  return shard;
};

/**
 * The shard's disposable database: its own variable when one machine runs
 * every shard at once, else the single one CI sets per job.
 */
export const shardDatabaseUrl = (
  shard: number,
  environment: Readonly<Record<string, string | undefined>>
): string => {
  const url =
    environment[`WORKSPACE_TEST_DATABASE_URL_SHARD_${shard}`] ||
    environment.WORKSPACE_TEST_DATABASE_URL;
  if (!url) {
    throw new Error(
      `Shard ${shard} needs a disposable test database: set WORKSPACE_TEST_DATABASE_URL_SHARD_${shard} or WORKSPACE_TEST_DATABASE_URL. Without one the database suites skip, and Turbo would cache the pass.`
    );
  }
  return url;
};

/** The environment the shard's tests run with. */
export const shardEnvironment = (
  environment: Readonly<Record<string, string | undefined>>,
  databaseUrl: string
): Record<string, string> => {
  const selected: Record<string, string> = {};
  for (const name of shardEnvironmentNames) {
    const value = environment[name];
    if (value !== undefined) selected[name] = value;
  }
  selected.WORKSPACE_TEST_DATABASE_URL = databaseUrl;
  return selected;
};

/**
 * Rejects a Bun other than the one the repository pins: Turbo hashes the
 * lockfile and root manifest, not the Bun binary that runs the tests.
 */
export const requirePinnedBun = (
  packageManager: string,
  runningVersion: string
): void => {
  const pinned = /^bun@(.+)$/.exec(packageManager)?.[1];
  if (pinned !== runningVersion) {
    throw new Error(
      `Workspace test shards run with the pinned ${packageManager}, not Bun ${runningVersion}.`
    );
  }
};

/**
 * The Workspace `bun test` arguments every run shares; the package `test`
 * script runs the same ones unsharded.
 */
export const workspaceTestArguments = [
  "--preload",
  "./shared/testing/workspace-test-env.ts",
  "--parallel=1",
  "--timeout",
  "30000",
  "--path-ignore-patterns=**/*.{build,repository-wide}.test.ts",
] as const;

/** The shard's `bun test` arguments, run from the package root. */
export const shardTestArguments = (shard: number): readonly string[] => [
  "test",
  ...workspaceTestArguments,
  "--no-env-file",
  `--shard=${shard}/${testShardCount}`,
  `--timings=./${shardTimingsRecording(shard)}`,
  "--timings=./test-timings.json",
  "--update-timings",
];

/**
 * Checks a shard's preconditions and clears its previous recording in
 * `directory`, then returns how to start its tests there.
 */
export const prepareShard = async (
  argument: string | undefined,
  environment: Readonly<Record<string, string | undefined>>,
  directory: string
): Promise<{
  readonly command: readonly string[];
  readonly environment: Record<string, string>;
}> => {
  const shard = parseShard(argument);
  requirePinnedBun(rootPackage.packageManager, Bun.version);
  const testEnvironment = shardEnvironment(
    environment,
    shardDatabaseUrl(shard, environment)
  );
  await rm(join(directory, shardTimingsRecording(shard)), { force: true });
  return {
    command: [process.execPath, ...shardTestArguments(shard)],
    environment: testEnvironment,
  };
};

const runShard = async (argument: string | undefined): Promise<number> => {
  const shard = await prepareShard(argument, process.env, workspaceRoot);
  const result = await runCommand(shard.command, {
    cwd: workspaceRoot,
    env: shard.environment,
    forwardOutput: { stdout: process.stdout, stderr: process.stderr },
  });
  return result.exitCode ?? 1;
};

if (import.meta.main) {
  runShard(process.argv[2])
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((error) => {
      process.stderr.write(
        `${error instanceof Error ? error.message : error}\n`
      );
      process.exitCode = 1;
    });
}
