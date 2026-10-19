import { constants } from "node:os";
import { join } from "node:path";
import { deferAfterCompileVariable } from "./next-build-after-compile.mjs";
import { describeTermination, runCommand } from "./shared/command";

const buildModeFlag = "--experimental-build-mode";

type BuildPhase = {
  readonly command: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
};

const nextBuild = (args: readonly string[]): readonly string[] => [
  "next",
  "build",
  "--turbo",
  ...args,
];

// After compiling, Turbopack persists its build cache while the same
// `next build` runs the after-compile hook (PostHog's source-map upload in
// production), collects page data, and prerenders. On Vercel's 8 GB build
// machine a cold build ran out of memory in that overlap. Compiling, running
// the hook, and generating in separate processes lets the compiler finish
// persisting and exit before the others start. An explicit build mode, such
// as CI's compile-only check, runs as given.
export const nextBuildPhases = (
  args: readonly string[]
): readonly BuildPhase[] =>
  args.some((arg) => arg.startsWith(buildModeFlag))
    ? [{ command: nextBuild(args) }]
    : [
        {
          command: nextBuild([`${buildModeFlag}=compile`, ...args]),
          env: { [deferAfterCompileVariable]: "1" },
        },
        // Node, like `next build` itself, runs the hook.
        {
          command: [
            "node",
            join(import.meta.dir, "next-build-after-compile.mjs"),
          ],
        },
        { command: nextBuild([`${buildModeFlag}=generate`, ...args]) },
      ];

if (import.meta.main) {
  for (const { command, env } of nextBuildPhases(Bun.argv.slice(2))) {
    // Each phase leads its own process group, so when this runner gets
    // SIGINT or SIGTERM it ends the phase's worker processes with it;
    // killing only the phase's own process would leave them running.
    const result = await runCommand(command, {
      env: { ...process.env, ...env },
      output: "inherit",
      ownProcessGroup: true,
    });
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
