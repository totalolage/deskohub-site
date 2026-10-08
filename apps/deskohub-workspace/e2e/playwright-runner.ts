export type WorkspacePlaywrightInvocation = "suite" | "failure-cleanup";

export type WorkspacePlaywrightResult = {
  readonly suiteExitCode: number;
  readonly cleanupExitCode?: number;
  readonly cleanupCouldNotStart?: true;
};

export const runWorkspacePlaywrightWithFailureCleanup = async (
  run: (invocation: WorkspacePlaywrightInvocation) => Promise<number>
): Promise<WorkspacePlaywrightResult> => {
  const suiteExitCode = await run("suite");
  if (suiteExitCode === 0) return { suiteExitCode };

  try {
    const cleanupExitCode = await run("failure-cleanup");
    return { cleanupExitCode, suiteExitCode };
  } catch {
    return { cleanupCouldNotStart: true, suiteExitCode };
  }
};
