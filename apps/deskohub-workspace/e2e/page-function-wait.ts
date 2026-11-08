import { errors, type JSHandle, type Page } from "@playwright/test";
import { workspaceE2EPollIntervalMs } from "./timeouts";

/**
 * Waits until `pageFunction`, run in the page with `arg`, returns a truthy
 * value, as `page.waitForFunction` does, polling every `polling` ms until
 * `deadline` (a `Date.now()` timestamp).
 *
 * The in-page wait is re-issued every `pageFunctionWake` ms. A WebKit page on
 * a loaded runner can stall its event loop, timers and network reads
 * included, until it receives a protocol command; a single long
 * `waitForFunction` then sees nothing until its own timeout aborts it.
 */
export const waitForPageFunction = async <Arg, Result>(
  page: Pick<Page, "waitForFunction">,
  pageFunction: (arg: Arg) => Result,
  arg: Arg,
  { deadline, polling }: { readonly deadline: number; readonly polling: number }
): Promise<JSHandle<Result>> => {
  const startedAt = Date.now();
  let reissues = 0;
  for (;;) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0)
      throw new errors.TimeoutError(
        `Page function wait timed out after ${Date.now() - startedAt}ms (re-issued ${reissues} times)`
      );
    try {
      // Playwright types the argument as its serialized form; plain data and
      // element handles are the same shape.
      return (await page.waitForFunction(
        pageFunction as (arg: unknown) => Result,
        arg,
        {
          polling,
          timeout: Math.min(
            remainingMs,
            workspaceE2EPollIntervalMs.pageFunctionWake
          ),
        }
      )) as JSHandle<Result>;
    } catch (error) {
      if (!(error instanceof errors.TimeoutError)) throw error;
      reissues += 1;
    }
  }
};
