// Runs every package's Bun tests with Istanbul instrumentation and writes
// coverage/coverage-final.json at the repository root. Arguments are passed to
// `turbo run test`, for example `bun run coverage --filter=@deskohub/dotypos`.
import { rmSync } from "node:fs";
import { join, resolve } from "node:path";
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

const repositoryRoot = resolve(import.meta.dir, "../../..");
const coverageDirectory = join(repositoryRoot, "coverage");
const cacheDirectory = join(coverageDirectory, "istanbul", "cache");
const runDirectory = join(
  coverageDirectory,
  "istanbul",
  "runs",
  `${Date.now()}-${process.pid}`
);
const reportFile = join(coverageDirectory, "coverage-final.json");
const preload = join(import.meta.dir, "coverage-preload.ts");

const sources = await listCoverageSources(repositoryRoot);
writeCoverageRun(runDirectory, { sources, cacheDirectory });

// BUN_OPTIONS puts the preload ahead of each package's own preloads.
// --force reruns cached test tasks so every package reports coverage.
const turbo = Bun.spawn(
  [
    "bun",
    "turbo",
    "run",
    "test",
    "--force",
    "--continue",
    ...Bun.argv.slice(2),
  ],
  {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      BUN_OPTIONS: [`--preload=${preload}`, process.env.BUN_OPTIONS]
        .filter(Boolean)
        .join(" "),
      [coverageRunDirectoryVariable]: runDirectory,
    },
    stdio: ["inherit", "inherit", "inherit"],
  }
);
const testExitCode = await turbo.exited;

const report = buildCoverageReport({
  dumpFiles: coverageDumpFiles(runDirectory),
  sources,
  instrumentation: createSourceInstrumentation(cacheDirectory),
});
writeFileAtomically(reportFile, JSON.stringify(report.coverage));
rmSync(runDirectory, { recursive: true, force: true });

process.stdout.write(
  `Wrote ${reportFile}: ${report.loadedFiles} source files loaded by tests, ${report.unloadedFiles} never loaded.\n`
);
if (testExitCode !== 0) {
  console.error(
    `Tests failed (turbo exited with ${testExitCode}); the report covers only the tests that ran.`
  );
  process.exitCode = testExitCode;
}
