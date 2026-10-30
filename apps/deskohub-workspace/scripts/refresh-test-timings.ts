import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { Schema } from "effect";
import workspacePackage from "../package.json";
import { runCommand } from "./shared/command";

const testTimingsSchema = Schema.Struct({
  version: Schema.Literal(1),
  files: Schema.Record(
    Schema.String,
    Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0))
  ),
});
const decodeTestTimings = Schema.decodeUnknownSync(
  Schema.fromJsonString(testTimingsSchema)
);

/**
 * Bun's `--timings` file: per-file wall time in milliseconds, including
 * module load and hooks. `bun test --shard` splits files by these durations,
 * so every shard must read the same committed file.
 */
export type TestTimings = typeof testTimingsSchema.Type;

const workspaceRoot = resolve(import.meta.dir, "..");
export const testTimingsPath = join(workspaceRoot, "test-timings.json");
export const shardTimingsArtifactPattern = "workspace-test-timings-shard-*";
const testFilePattern = "**/*{.,_}{test,spec}.{ts,tsx,js,jsx,mjs,cjs}";

/** Reads the `--path-ignore-patterns` globs from a `bun test` command line. */
export const testPathIgnorePatterns = (
  testCommand: string
): ReadonlyArray<string> =>
  Array.from(
    testCommand.matchAll(
      /--path-ignore-patterns(?:=|\s+)(?:'([^']*)'|"([^"]*)"|(\S+))/g
    ),
    ([, singleQuoted, doubleQuoted, bare]) =>
      singleQuoted ?? doubleQuoted ?? bare ?? ""
  );

// Every shard runs the `test` script, so its ignores, such as the
// build-output checks CI runs after a build, decide which files get timed.
const shardIgnoredTestPatterns = testPathIgnorePatterns(
  workspacePackage.scripts.test
).map((pattern) => new Bun.Glob(pattern));

/** Whether the sharded `test` script runs this workspace-relative file. */
export const isShardedTestFile = (file: string) =>
  !file.split("/").includes("node_modules") &&
  !shardIgnoredTestPatterns.some((pattern) => pattern.match(file));

/** Orders entries by path code units, as Bun orders test files. */
const byPath = (
  [a]: readonly [string, number],
  [b]: readonly [string, number]
) => Number(a > b) - Number(a < b);

export const parseTestTimings = (text: string, source: string): TestTimings => {
  try {
    return decodeTestTimings(text);
  } catch (error) {
    throw new Error(`${source} is not a valid Bun test timings file`, {
      cause: error,
    });
  }
};

/** Combines disjoint per-shard recordings into one path-sorted file. */
export const mergeTestTimings = (
  shards: ReadonlyArray<TestTimings>
): TestTimings => {
  const files = new Map<string, number>();
  for (const shard of shards) {
    for (const [file, ms] of Object.entries(shard.files)) {
      if (files.has(file)) {
        throw new Error(`${file} was recorded by more than one shard`);
      }
      files.set(file, Math.round(ms));
    }
  }
  return {
    version: 1,
    files: Object.fromEntries([...files].sort(byPath)),
  };
};

/**
 * Explains how a run's recorded files differ from the checkout's test files,
 * or returns undefined when they match. A pull request run tests the branch
 * merged with its base, so a test file the base added or renamed after the
 * branch diverged shows up as a mismatch.
 */
export const describeRecordingMismatch = (
  testFiles: ReadonlyArray<string>,
  timings: TestTimings
): string | undefined => {
  const checkoutFiles = new Set(testFiles);
  const unrecorded = testFiles.filter((file) => !(file in timings.files));
  const absent = Object.keys(timings.files).filter(
    (file) => !checkoutFiles.has(file)
  );
  if (unrecorded.length === 0 && absent.length === 0) return undefined;
  return [
    ...(unrecorded.length > 0
      ? [`No duration for ${unrecorded.length} local test file(s):`]
      : []),
    ...unrecorded,
    ...(absent.length > 0
      ? [`Durations for ${absent.length} file(s) this checkout lacks:`]
      : []),
    ...absent,
    "Refresh from a run of the checked-out commit where every shard finished. Pull request runs test the branch merged with its base, so merge the base branch and push before that run.",
  ].join("\n");
};

export const formatTestTimings = (timings: TestTimings): string =>
  `${JSON.stringify(timings, null, 2)}\n`;

/**
 * Predicts each shard's total the way Bun 1.4 splits `--shard` with timings:
 * it cuts the path-sorted files into contiguous ranges at every
 * `shard * total / shardCount` mark, keeping the file that crosses a mark on
 * the side nearer to it. One slow file, or slow files adjacent by path, bound
 * the balance, so split slow test files rather than adding shards.
 */
export const predictShardDurations = (
  timings: TestTimings,
  shardCount: number
): ReadonlyArray<number> => {
  const durations = Object.entries(timings.files)
    .sort(byPath)
    .map(([, ms]) => ms);
  const total = durations.reduce((sum, ms) => sum + ms, 0);
  const totals = Array.from({ length: shardCount }, () => 0);
  let shard = 0;
  let elapsed = 0;
  for (const ms of durations) {
    const mark = ((shard + 1) * total) / shardCount;
    const crossesMark = shard < shardCount - 1 && elapsed + ms >= mark;
    const startsNextShard = crossesMark && elapsed + ms - mark > mark - elapsed;
    if (startsNextShard) shard += 1;
    totals[shard] = (totals[shard] ?? 0) + ms;
    elapsed += ms;
    if (crossesMark && !startsNextShard) shard += 1;
  }
  return totals;
};

const discoverTestFiles = async (): Promise<ReadonlyArray<string>> => {
  const files: string[] = [];
  for await (const file of new Bun.Glob(testFilePattern).scan(workspaceRoot)) {
    if (isShardedTestFile(file)) files.push(file);
  }
  return files;
};

const downloadShardTimings = async (
  runId: string
): Promise<ReadonlyArray<TestTimings>> => {
  const directory = await mkdtemp(join(tmpdir(), "workspace-test-timings-"));
  try {
    const download = await runCommand([
      "gh",
      "run",
      "download",
      runId,
      "--pattern",
      shardTimingsArtifactPattern,
      "--dir",
      directory,
    ]);
    if (download.exitCode !== 0) {
      throw new Error(
        `gh run download ${runId} failed (exit ${download.exitCode}):\n${download.stderr}`
      );
    }
    const shards: TestTimings[] = [];
    for await (const file of new Bun.Glob("*/test-timings.json").scan(
      directory
    )) {
      const path = join(directory, file);
      shards.push(
        parseTestTimings(
          await readFile(path, "utf8"),
          relative(directory, path)
        )
      );
    }
    return shards;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
};

const refreshTestTimings = async (runId: string) => {
  const shards = await downloadShardTimings(runId);
  const timings = mergeTestTimings(shards);
  const mismatch = describeRecordingMismatch(
    await discoverTestFiles(),
    timings
  );
  if (mismatch) {
    throw new Error(
      `Run ${runId} did not time this checkout's test files.\n${mismatch}`
    );
  }
  await writeFile(testTimingsPath, formatTestTimings(timings));
  const seconds = predictShardDurations(timings, shards.length).map(
    (ms) => `${(ms / 1000).toFixed(0)}s`
  );
  process.stdout.write(
    `Wrote ${Object.keys(timings.files).length} file durations to ${relative(process.cwd(), testTimingsPath)}; predicted shard totals ${seconds.join(", ")}\n`
  );
};

if (import.meta.main) {
  const runId = process.argv[2];
  if (!(runId && /^\d+$/.test(runId))) {
    process.stderr.write(
      "Usage: refresh-test-timings.ts <workspace-ci-run-id>\n"
    );
    process.exit(1);
  }

  refreshTestTimings(runId).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : error}\n`);
    process.exit(1);
  });
}
