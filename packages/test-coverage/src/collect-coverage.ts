// Runs every package's Bun tests with Istanbul instrumentation and writes
// coverage/coverage-final.json at the repository root, with
// coverage/coverage-sources.json recording which source the counts describe.
// Arguments are passed to `turbo run test`, for example
// `bun run coverage --filter=@deskohub/dotypos`; a run that selects packages
// is marked partial.
import { join, resolve } from "node:path";
import { measureCoverage, turboTestScope } from "./coverage-measurement";

const repositoryRoot = resolve(import.meta.dir, "../../..");
const turboArguments = Bun.argv.slice(2);

// --force reruns cached test tasks so every package reports coverage.
const measurement = await measureCoverage({
  repositoryRoot,
  outputDirectory: join(repositoryRoot, "coverage"),
  command: ["bun", "turbo", "run", "test", "--force", "--continue"].concat(
    turboArguments
  ),
  cwd: repositoryRoot,
  scope: turboTestScope(turboArguments),
});

process.stdout.write(
  `Wrote ${measurement.reportFile}: ${measurement.loadedFiles} source files loaded by tests, ${measurement.unloadedFiles} never loaded.\n`
);
if (measurement.testExitCode !== 0) {
  console.error(
    `Tests failed (turbo exited with ${measurement.testExitCode}); the report covers only the tests that ran.`
  );
  process.exitCode = measurement.testExitCode;
}
