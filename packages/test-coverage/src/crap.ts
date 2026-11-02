// CRAP scores of business functions, from Fallow's complexity analysis and
// real Istanbul coverage.
//
//   bun run crap index
//     Scores every business function against coverage/coverage-final.json
//     (written by `bun run coverage`) and writes coverage/crap-index.json and
//     coverage/crap-index.tsv with every function scoring 10 or more. The JSON
//     also counts the evidence behind every score and lists the functions
//     whose scores aren't measured.
//
//   bun run crap <path> [<line>|<name>] [--test <test path>]...
//     Prints the scores of one file's functions, or of the function starting
//     at <line> or named <name>. With --test, it first measures coverage by
//     running only those test files (one package's), so the result describes
//     the current source; the coverage is then a lower bound. Without --test it
//     uses coverage/coverage-final.json. Exits 1 when a printed function scores
//     10 or more or its coverage isn't measured against the current source.
//
// Paths are repository-relative or absolute.
import { existsSync, rmSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { measureCoverage } from "./coverage-measurement";
import {
  buildCrapIndex,
  crapLimit,
  type FunctionCrap,
  formatCrapTable,
  isViolation,
  scoreFunctions,
} from "./crap-scores";
import { writeFileAtomically } from "./source-instrumentation";
import { readSourceManifest } from "./source-manifest";

const repositoryRoot = resolve(import.meta.dir, "../../..");
const coverageDirectory = join(repositoryRoot, "coverage");

const [command, ...rest] = Bun.argv.slice(2);
if (command === undefined || command === "--help") {
  process.stdout.write(
    "Usage: bun run crap index | bun run crap <path> [<line>|<name>] [--test <test path>]...\n"
  );
} else if (command === "index") {
  await writeIndex();
} else {
  await printFunctionScores(command, rest);
}

async function writeIndex(): Promise<void> {
  const manifest = readSourceManifest(coverageDirectory);
  const scores = await scoreFunctions({
    repositoryRoot,
    coverageFile: join(coverageDirectory, "coverage-final.json"),
    manifest,
    workDirectory: join(coverageDirectory, "crap"),
  });
  const index = buildCrapIndex(manifest, scores);
  writeFileAtomically(
    join(coverageDirectory, "crap-index.json"),
    JSON.stringify(index, null, 2)
  );
  writeFileAtomically(
    join(coverageDirectory, "crap-index.tsv"),
    `${formatCrapTable(index.violations)}\n`
  );
  process.stdout.write(
    [
      `Coverage of ${index.revision} from ${index.coverageGeneratedAt}${index.completeCoverage ? "" : " (INCOMPLETE: a subset of tests ran or some failed)"}.`,
      `${index.businessFunctions} business functions: ${index.functionEvidence.measured} measured, ${index.functionEvidence.stale} stale, ${index.functionEvidence.estimated} estimated.`,
      `${index.violations.length} score ${crapLimit} or more: ${index.violationEvidence.measured} measured, ${index.violationEvidence.stale} stale, ${index.violationEvidence.estimated} estimated.`,
      `Wrote ${join(coverageDirectory, "crap-index.json")} and crap-index.tsv.`,
      "",
    ].join("\n")
  );
}

async function printFunctionScores(
  path: string,
  options: ReadonlyArray<string>
): Promise<void> {
  const target = repositoryPath(path);
  const { selector, tests } = parseOptions(options);
  const measurement =
    tests.length === 0
      ? { directory: coverageDirectory, temporary: false }
      : await measureTargetedCoverage(tests);
  try {
    const scores = await scoreFunctions({
      repositoryRoot,
      coverageFile: join(measurement.directory, "coverage-final.json"),
      manifest: readSourceManifest(measurement.directory),
      workDirectory: measurement.directory,
    });
    const matches = scores.filter(
      (score) => score.path === target && matchesSelector(score, selector)
    );
    if (matches.length === 0) {
      throw new Error(
        `No business function in ${target}${selector === undefined ? "" : ` matches ${selector}`}`
      );
    }
    process.stdout.write(`${formatCrapTable(matches)}\n`);
    if (
      matches.some(
        (score) => isViolation(score) || score.evidence !== "measured"
      )
    ) {
      process.exitCode = 1;
    }
  } finally {
    if (measurement.temporary) {
      rmSync(measurement.directory, { recursive: true, force: true });
    }
  }
}

function parseOptions(options: ReadonlyArray<string>): {
  readonly selector: string | undefined;
  readonly tests: ReadonlyArray<string>;
} {
  let selector: string | undefined;
  const tests: string[] = [];
  for (let index = 0; index < options.length; index += 1) {
    const option = options[index];
    if (option === "--test") {
      const test = options[index + 1];
      if (test === undefined) {
        throw new Error("--test needs a test path");
      }
      tests.push(repositoryPath(test));
      index += 1;
    } else if (selector === undefined) {
      selector = option;
    } else {
      throw new Error(`Unexpected argument ${option}`);
    }
  }
  return { selector, tests };
}

function matchesSelector(
  score: FunctionCrap,
  selector: string | undefined
): boolean {
  if (selector === undefined) {
    return true;
  }
  return /^\d+$/.test(selector)
    ? score.line === Number(selector)
    : score.name === selector;
}

/** Runs one package's test files with coverage into a scratch directory. */
async function measureTargetedCoverage(
  tests: ReadonlyArray<string>
): Promise<{ readonly directory: string; readonly temporary: true }> {
  const packageDirectories = new Set(
    tests.map((test) => packageDirectory(join(repositoryRoot, test)))
  );
  const [cwd, ...others] = packageDirectories;
  if (cwd === undefined || others.length > 0) {
    throw new Error("--test paths must belong to one package");
  }
  const directory = join(
    coverageDirectory,
    "targeted",
    `${Date.now()}-${process.pid}`
  );
  const measurement = await measureCoverage({
    repositoryRoot,
    outputDirectory: directory,
    command: [
      "bun",
      "run",
      "test",
      ...tests.map((test) => `./${relative(cwd, join(repositoryRoot, test))}`),
    ],
    cwd,
    scope: { kind: "partial", tests },
  });
  if (measurement.testExitCode !== 0) {
    rmSync(directory, { recursive: true, force: true });
    throw new Error(
      `The tests exited with ${measurement.testExitCode}; fix them before reading coverage`
    );
  }
  return { directory, temporary: true };
}

function packageDirectory(path: string): string {
  let directory = dirname(path);
  while (!existsSync(join(directory, "package.json"))) {
    const parent = dirname(directory);
    if (parent === directory || directory === repositoryRoot) {
      throw new Error(`${path} is not inside a package`);
    }
    directory = parent;
  }
  return directory;
}

function repositoryPath(path: string): string {
  const absolute = isAbsolute(path) ? path : join(repositoryRoot, path);
  const relativePath = relative(repositoryRoot, absolute);
  if (relativePath.startsWith("..")) {
    throw new Error(`${path} is outside the repository`);
  }
  return relativePath;
}
