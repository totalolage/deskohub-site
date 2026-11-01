import { readFileSync } from "node:fs";
import {
  type CoverageMapData,
  createCoverageMap,
  createFileCoverage,
} from "istanbul-lib-coverage";
import type { SourceInstrumentation } from "./source-instrumentation";

export type CoverageReport = {
  readonly coverage: CoverageMapData;
  /** Source files at least one test process loaded. */
  readonly loadedFiles: number;
  /** Source files no test loaded, reported with zero counts. */
  readonly unloadedFiles: number;
};

/**
 * Merges the dumps of a run into one Istanbul coverage map that holds every
 * source file, so files no test imports count as unexecuted instead of
 * missing.
 */
export function buildCoverageReport({
  dumpFiles,
  sources,
  instrumentation,
}: {
  readonly dumpFiles: ReadonlyArray<string>;
  readonly sources: ReadonlyArray<string>;
  readonly instrumentation: SourceInstrumentation;
}): CoverageReport {
  const coverage = createCoverageMap({});
  for (const dumpFile of dumpFiles) {
    coverage.merge(readCoverageDump(dumpFile));
  }
  const sourceSet = new Set(sources);
  const loaded = new Set(coverage.files());
  const strayFile = [...loaded].find((file) => !sourceSet.has(file));
  if (strayFile !== undefined) {
    throw new Error(
      `Coverage dump covers ${strayFile}, outside the run's sources`
    );
  }
  for (const source of sources) {
    if (loaded.has(source)) {
      continue;
    }
    coverage.addFileCoverage(
      createFileCoverage(
        instrumentation.unexecutedCoverage(source, readFileSync(source, "utf8"))
      )
    );
  }
  return {
    coverage: coverage.toJSON(),
    loadedFiles: loaded.size,
    unloadedFiles: sources.length - loaded.size,
  };
}

function readCoverageDump(dumpFile: string): CoverageMapData {
  const dump: unknown = JSON.parse(readFileSync(dumpFile, "utf8"));
  if (!isCoverageMapData(dump)) {
    throw new Error(`Malformed coverage dump ${dumpFile}`);
  }
  return dump;
}

function isCoverageMapData(value: unknown): value is CoverageMapData {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every(isFileCoverageData)
  );
}

function isFileCoverageData(value: unknown): boolean {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const file: Record<string, unknown> = { ...value };
  return (
    typeof file.path === "string" &&
    [file.statementMap, file.fnMap, file.branchMap].every(isPlainRecord) &&
    isCounterRecord(file.s, isCount) &&
    isCounterRecord(file.f, isCount) &&
    isCounterRecord(
      file.b,
      (counts) => Array.isArray(counts) && counts.every(isCount)
    )
  );
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCounterRecord(
  value: unknown,
  isCounter: (counter: unknown) => boolean
): boolean {
  return isPlainRecord(value) && Object.values(value).every(isCounter);
}

function isCount(value: unknown): boolean {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}
