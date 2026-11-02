import { rmSync } from "node:fs";
import { join } from "node:path";
import { buildCoverageReport } from "./coverage-report";
import {
  coverageDumpFiles,
  coverageRunDirectoryVariable,
  writeCoverageRun,
} from "./coverage-run";
import { listCoverageSources } from "./source-files";
import {
  createSourceInstrumentation,
  writeFileAtomically,
} from "./source-instrumentation";
import {
  type CoverageScope,
  hashSources,
  stableHashes,
  writeSourceManifest,
} from "./source-manifest";

const preload = join(import.meta.dir, "coverage-preload.ts");

const turboSelection = /^(?:--filter|-F|--affected)(?:=|$)/;

/**
 * The scope of `turbo run test` with these arguments: partial when they
 * select packages, complete when they only change how Turbo runs.
 */
export function turboTestScope(
  turboArguments: ReadonlyArray<string>
): CoverageScope {
  return turboArguments.some((argument) => turboSelection.test(argument))
    ? { kind: "partial", tests: [`turbo run test ${turboArguments.join(" ")}`] }
    : { kind: "complete" };
}

export type CoverageMeasurement = {
  readonly reportFile: string;
  readonly loadedFiles: number;
  readonly unloadedFiles: number;
  readonly testExitCode: number;
};

/**
 * Runs a test command with Istanbul instrumentation and writes
 * coverage-final.json plus the source manifest that records which source the
 * counts describe into the output directory.
 */
export async function measureCoverage({
  repositoryRoot,
  outputDirectory,
  command,
  cwd,
  scope,
}: {
  readonly repositoryRoot: string;
  readonly outputDirectory: string;
  readonly command: ReadonlyArray<string>;
  readonly cwd: string;
  readonly scope: CoverageScope;
}): Promise<CoverageMeasurement> {
  const cacheDirectory = join(repositoryRoot, "coverage", "istanbul", "cache");
  const runDirectory = join(
    repositoryRoot,
    "coverage",
    "istanbul",
    "runs",
    `${Date.now()}-${process.pid}`
  );
  const reportFile = join(outputDirectory, "coverage-final.json");
  const sources = await listCoverageSources(repositoryRoot);
  const revision = await gitRevision(repositoryRoot);
  const hashesBefore = hashSources(repositoryRoot, sources);
  writeCoverageRun(runDirectory, { sources, cacheDirectory });

  // BUN_OPTIONS puts the preload ahead of each package's own preloads.
  const tests = Bun.spawn([...command], {
    cwd,
    env: {
      ...process.env,
      BUN_OPTIONS: [`--preload=${preload}`, process.env.BUN_OPTIONS]
        .filter(Boolean)
        .join(" "),
      [coverageRunDirectoryVariable]: runDirectory,
    },
    stdio: ["inherit", "inherit", "inherit"],
  });
  const testExitCode = await tests.exited;

  const report = buildCoverageReport({
    dumpFiles: coverageDumpFiles(runDirectory),
    sources,
    instrumentation: createSourceInstrumentation(cacheDirectory),
  });
  writeFileAtomically(reportFile, JSON.stringify(report.coverage));
  writeSourceManifest(outputDirectory, {
    revision,
    generatedAt: new Date().toISOString(),
    scope,
    testExitCode,
    files: stableHashes(hashesBefore, hashSources(repositoryRoot, sources)),
  });
  rmSync(runDirectory, { recursive: true, force: true });
  return {
    reportFile,
    loadedFiles: report.loadedFiles,
    unloadedFiles: report.unloadedFiles,
    testExitCode,
  };
}

async function gitRevision(repositoryRoot: string): Promise<string> {
  const git = Bun.spawn(["git", "rev-parse", "HEAD"], {
    cwd: repositoryRoot,
    stdout: "pipe",
    stderr: "inherit",
  });
  const [output, exitCode] = await Promise.all([
    new Response(git.stdout).text(),
    git.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(`git rev-parse HEAD exited with ${exitCode}`);
  }
  return output.trim();
}
