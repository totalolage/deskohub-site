import { $ } from "bun";

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
    await $`next build --turbo ${runArgs}`;
  }
}
