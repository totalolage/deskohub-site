import { afterAll } from "bun:test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { plugin } from "bun";
import {
  coverageDumpDirectory,
  coverageRunDirectoryVariable,
  readCoverageRun,
} from "./coverage-run";
import {
  createSourceInstrumentation,
  writeFileAtomically,
} from "./source-instrumentation";

type CoverageGlobal = typeof globalThis & {
  __coverage__?: unknown;
  __deskohubCoverageDumpId?: string;
};

/**
 * Instruments the run's source files as Bun loads them and writes this
 * process's Istanbul counters to the run's dump directory. A no-op outside a
 * coverage run, and in processes no test started, such as build steps.
 */
export function startCoverageCollection(
  environment: Record<string, string | undefined>
): void {
  const runDirectory = environment[coverageRunDirectoryVariable];
  if (runDirectory === undefined || runDirectory === "") {
    return;
  }
  const dumpScheduler = scheduleCoverageDump(environment);
  if (dumpScheduler === undefined) {
    return;
  }
  const run = readCoverageRun(runDirectory);
  const instrumentation = createSourceInstrumentation(run.cacheDirectory);
  // Bun rejects an onLoad callback that declines a file, so the filter alone
  // selects the run's sources.
  const filter = new RegExp(
    `^(?:${run.sources.map((source) => RegExp.escape(source)).join("|")})$`
  );
  plugin({
    name: "istanbul-coverage",
    setup(build) {
      build.onLoad({ filter }, ({ path }) => ({
        contents: instrumentation.instrument(path, readFileSync(path, "utf8")),
        loader: sourceLoader(path),
      }));
    },
  });
  dumpScheduler(() => dumpCoverage(coverageDumpDirectory(runDirectory)));
}

/**
 * Returns how to schedule the dump for this process. In the test runner it
 * runs after each test file's tests: an isolated file has its own global, and
 * a shared global's counters accumulate, so each global overwrites one file. A
 * process a test spawned, which inherits the runner's NODE_ENV=test, dumps on
 * exit.
 */
function scheduleCoverageDump(
  environment: Record<string, string | undefined>
): ((dump: () => void) => void) | undefined {
  try {
    afterAll(() => undefined);
  } catch {
    // Not the test runner: bun:test refuses hooks outside `bun test`.
    if (environment.NODE_ENV !== "test") {
      return undefined;
    }
    return (dump) => process.on("exit", dump);
  }
  return (dump) => afterAll(dump);
}

function dumpCoverage(dumpDirectory: string): void {
  const coverageGlobal: CoverageGlobal = globalThis;
  if (coverageGlobal.__coverage__ === undefined) {
    return;
  }
  coverageGlobal.__deskohubCoverageDumpId ??= `${process.pid}-${randomUUID()}`;
  writeFileAtomically(
    join(dumpDirectory, `${coverageGlobal.__deskohubCoverageDumpId}.json`),
    JSON.stringify(coverageGlobal.__coverage__)
  );
}

function sourceLoader(path: string): "js" | "jsx" | "ts" | "tsx" {
  if (path.endsWith(".tsx")) return "tsx";
  if (path.endsWith(".jsx")) return "jsx";
  if (/\.[cm]?ts$/.test(path)) return "ts";
  return "js";
}
