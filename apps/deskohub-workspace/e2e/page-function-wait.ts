import { errors } from "@playwright/test";
import { workspaceE2EPollIntervalMs } from "./timeouts";

/**
 * Runs an in-page wait, such as a `page.waitForFunction` call given the slice
 * timeout, in slices of at most `pageFunctionWake` ms until it resolves or
 * `deadline` (a `Date.now()` timestamp) passes.
 *
 * A WebKit page on a loaded runner has been seen to stop making progress,
 * timers and network reads included, until the long `waitForFunction`
 * waiting on it timed out and Playwright sent it an abort. The working
 * hypothesis is that the inbound command resumed it; each new slice sends the
 * page fresh commands and runs the page function once on arrival.
 */
export const waitForPageFunction = async <Result>(
  waitSlice: (timeoutMs: number) => Promise<Result>,
  deadline: number
): Promise<Result> => {
  const startedAt = Date.now();
  let reissues = 0;
  for (;;) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0)
      throw new errors.TimeoutError(
        `Page function wait timed out after ${Date.now() - startedAt}ms (re-issued ${reissues} times)`
      );
    try {
      return await waitSlice(
        Math.min(remainingMs, workspaceE2EPollIntervalMs.pageFunctionWake)
      );
    } catch (error) {
      if (!(error instanceof errors.TimeoutError)) throw error;
      reissues += 1;
    }
  }
};
