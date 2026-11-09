import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { writeFileAtomically } from "./source-instrumentation";

/** Names the run directory of the coverage run a test process belongs to. */
export const coverageRunDirectoryVariable = "DESKOHUB_COVERAGE_RUN_DIR";

export type CoverageRun = {
  /** Absolute paths of every source file the report must include. */
  readonly sources: ReadonlyArray<string>;
  /** Instrumented-code cache shared across runs. */
  readonly cacheDirectory: string;
};

const runFile = (runDirectory: string) => join(runDirectory, "run.json");
export const coverageDumpDirectory = (runDirectory: string) =>
  join(runDirectory, "dumps");

export function writeCoverageRun(runDirectory: string, run: CoverageRun): void {
  writeFileAtomically(runFile(runDirectory), JSON.stringify(run));
}

export function readCoverageRun(runDirectory: string): CoverageRun {
  const run: unknown = JSON.parse(readFileSync(runFile(runDirectory), "utf8"));
  if (
    typeof run !== "object" ||
    run === null ||
    !("sources" in run) ||
    !Array.isArray(run.sources) ||
    !run.sources.every((source) => typeof source === "string") ||
    !("cacheDirectory" in run) ||
    typeof run.cacheDirectory !== "string"
  ) {
    throw new Error(`Malformed coverage run file in ${runDirectory}`);
  }
  return { sources: run.sources, cacheDirectory: run.cacheDirectory };
}

/** Paths of the coverage dumps test processes wrote for the run. */
export function coverageDumpFiles(runDirectory: string): string[] {
  const directory = coverageDumpDirectory(runDirectory);
  try {
    return readdirSync(directory)
      .filter((name) => name.endsWith(".json"))
      .map((name) => join(directory, name));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
}
