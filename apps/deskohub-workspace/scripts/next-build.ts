import { constants } from "node:os";
import { describeTermination, runCommand } from "./shared/command";

const buildModeFlag = "--experimental-build-mode";

// After compiling, Turbopack persists its build cache while the same
// `next build` collects page data and prerenders. On Vercel's 8 GB build
// machine a cold build ran out of memory in that overlap. Compiling and
// generating in separate processes lets the compiler finish persisting and exit
// before the generation workers start. An explicit build mode, such as CI's
// compile-only check, runs as given.
export const nextBuildRuns = (args: readonly string[]) =>
  args.some((arg) => arg.startsWith(buildModeFlag))
    ? [args]
    : [
        [`${buildModeFlag}=compile`, ...args],
        [`${buildModeFlag}=generate`, ...args],
      ];

if (import.meta.main) {
  for (const runArgs of nextBuildRuns(Bun.argv.slice(2))) {
    const command = ["next", "build", "--turbo", ...runArgs];
    // The command stays in this process group, so a terminal's or
    // supervisor's signal reaches it, and a signal to this runner alone ends
    // it before the runner exits.
    const result = await runCommand(command, { output: "inherit" });
    const failure = describeTermination(result);
    if (failure !== undefined) {
      console.error(`\`${command.join(" ")}\` ${failure}`);
      // Keep a signal's shell status, such as 137 for an out-of-memory kill.
      const signal =
        result.signalCode === null
          ? undefined
          : constants.signals[result.signalCode as NodeJS.Signals];
      process.exit(
        signal === undefined ? (result.exitCode ?? 1) : 128 + signal
      );
    }
  }
}
