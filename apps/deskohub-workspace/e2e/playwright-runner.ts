import { tmpdir } from "node:os";
import { basename, join } from "node:path";

export type WorkspacePlaywrightInvocation = "suite" | "failure-cleanup";

export type WorkspacePlaywrightResult = {
  readonly suiteExitCode: number;
  readonly cleanupExitCode?: number;
  readonly cleanupCouldNotStart?: true;
  readonly cleanupSkippedWithoutRunContext?: true;
};

// The checkout and instant navigation processes run concurrently, and
// Playwright writes transform cache entries in place, so a shared cache can
// hand one process a module the other is still writing. Each config's
// process gets its own cache; runs of one config stay sequential.
const playwrightTransformCacheDir = (config: string) =>
  join(
    tmpdir(),
    `playwright-transform-cache-${process.geteuid?.() ?? "user"}-${basename(config, ".ts")}`
  );

export const workspacePlaywrightProcessEnvironment = ({
  config,
  environment,
}: {
  readonly config: string;
  readonly environment: Readonly<Record<string, string>>;
}): Record<string, string> => ({
  ...environment,
  PWTEST_CACHE_DIR: playwrightTransformCacheDir(config),
});

export const runWorkspacePlaywrightWithFailureCleanup = async (
  run: (invocation: WorkspacePlaywrightInvocation) => Promise<number>,
  hasRunContext: () => Promise<boolean>
): Promise<WorkspacePlaywrightResult> => {
  const suiteExitCode = await run("suite");
  if (suiteExitCode === 0) return { suiteExitCode };
  // Setup records the run context before it leases or seeds anything, so a
  // suite that failed earlier left nothing for cleanup to reconcile.
  if (!(await hasRunContext())) {
    return { cleanupSkippedWithoutRunContext: true, suiteExitCode };
  }

  try {
    const cleanupExitCode = await run("failure-cleanup");
    return { cleanupExitCode, suiteExitCode };
  } catch {
    return { cleanupCouldNotStart: true, suiteExitCode };
  }
};

export type WorkspacePlaywrightSuitesResult = {
  readonly checkout: PromiseSettledResult<WorkspacePlaywrightResult>;
  readonly instantNavigation: PromiseSettledResult<number>;
};

// Settles only after both runs finish, so a launch failure in one cannot let
// the caller exit (and release shared E2E allocations) while the other runs.
export const runWorkspacePlaywrightSuites = async (runs: {
  readonly checkout: (
    invocation: WorkspacePlaywrightInvocation
  ) => Promise<number>;
  readonly hasCheckoutRunContext: () => Promise<boolean>;
  readonly instantNavigation: () => Promise<number>;
}): Promise<WorkspacePlaywrightSuitesResult> => {
  const [checkout, instantNavigation] = await Promise.allSettled([
    Promise.try(() =>
      runWorkspacePlaywrightWithFailureCleanup(
        runs.checkout,
        runs.hasCheckoutRunContext
      )
    ),
    Promise.try(runs.instantNavigation),
  ]);
  return { checkout, instantNavigation };
};
