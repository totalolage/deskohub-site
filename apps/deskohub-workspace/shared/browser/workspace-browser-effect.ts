import { NextEffect } from "@deskohub/next-effect";
import { Effect, References } from "effect";

interface RunWorkspaceBrowserEffectOptions {
  readonly signal?: AbortSignal;
}

/**
 * Runs a Workspace Effect in the browser, the client counterpart of
 * `runWorkspaceEffect`. The promise rejects with the squashed failure or
 * defect; Next.js control flow such as `redirect` and `notFound` is rethrown
 * unchanged, and an aborted `signal` interrupts the run. `Effect.log*` output
 * is discarded so raw causes never reach the console; report failures with
 * `reportWorkspaceBrowserFailure`, which reads this run's `operation`.
 */
export const runWorkspaceBrowserEffect =
  (operation: string, options: RunWorkspaceBrowserEffectOptions = {}) =>
  <A, E>(effect: Effect.Effect<A, E, never>): Promise<A> =>
    workspaceBrowserRuntime.run(
      effect.pipe(
        Effect.annotateLogs({ boundary: "browser", operation }),
        Effect.provideService(References.CurrentLoggers, noLoggers)
      ),
      { signal: options.signal }
    );

/**
 * Runs a Workspace Effect in the browser for a lifetime that ends when
 * `signal` aborts, such as a mounted component's. The abort interrupts the
 * Effect and settles the promise: ending the lifetime is the expected way out,
 * not a failure. Failures and defects reject as with `runWorkspaceBrowserEffect`.
 */
export const runWorkspaceBrowserEffectUntilAbort =
  (operation: string, signal: AbortSignal) =>
  <A, E>(effect: Effect.Effect<A, E, never>): Promise<void> =>
    effect.pipe(
      Effect.asVoid,
      Effect.raceFirst(awaitAbort(signal)),
      runWorkspaceBrowserEffect(operation)
    );

const awaitAbort = (signal: AbortSignal) =>
  Effect.callback<void>((resume) => {
    if (signal.aborted) return resume(Effect.void);
    const onAbort = () => resume(Effect.void);
    signal.addEventListener("abort", onAbort, { once: true });
    return Effect.sync(() => signal.removeEventListener("abort", onAbort));
  });

const workspaceBrowserRuntime = NextEffect.make();

// Effect's `Logger` module would add ~20 KB gzip to every page's first load.
const noLoggers = new Set<never>();
