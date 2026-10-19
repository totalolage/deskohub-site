import { NextEffect } from "@deskohub/next-effect";
import { waitUntil } from "@vercel/functions";
import { Cause, Data, Effect, Exit, Layer, Result } from "effect";
import { unstable_rethrow } from "next/navigation";
import { after } from "next/server";
import { postHogLoggerProvider } from "@/instrumentation";
import {
  createWorkspaceOtelLoggerLive,
  WorkspaceLoggerLive,
} from "./logging/censorship";
import { flushPostHogLogs } from "./logging/posthog-otel";
import { WorkspaceTracingLive } from "./observability/workspace-tracing";
import { runStandaloneWorkspaceEffect } from "./standalone-workspace-effect";

type WorkspaceEffectBoundary = "action" | "page" | "route" | "run" | "task";

interface RunWorkspaceEffectOptions {
  readonly boundary?: WorkspaceEffectBoundary;
  readonly signal?: AbortSignal;
}

interface RunWorkspaceEffectOrElseOptions<B> extends RunWorkspaceEffectOptions {
  /** Stable, low-cardinality log code without IDs, URLs, or payload data. */
  readonly failureCode: string;
  /**
   * Runs exactly once on any failure, with the error `runWorkspaceEffect`
   * would have rejected with. Returns the fallback value, or rethrows to
   * reject after a side effect such as `cacheLife`.
   */
  readonly orElse: (cause: unknown) => B;
}

/** What `orElse` threw, carried to the boundary that rethrows it. */
class WorkspaceFallbackRejection extends Data.TaggedError(
  "WorkspaceFallbackRejection"
)<{
  readonly cause: unknown;
}> {}

class WorkspaceTelemetryError extends Data.TaggedError(
  "WorkspaceTelemetryError"
)<{
  readonly cause: unknown;
  readonly message: string;
}> {}

export const runWorkspaceEffect =
  (operation: string, options: RunWorkspaceEffectOptions = {}) =>
  <A, E>(effect: Effect.Effect<A, E, never>): Promise<A> => {
    const run = workspaceRuntime.run(
      effect.pipe(
        Effect.annotateLogs({
          boundary: options.boundary ?? "run",
          operation,
        })
      ),
      { signal: options.signal }
    );
    // Next.js hands background `use cache` revalidations to `waitUntil` only
    // once the shell is ready, so a revalidation started by a later-streamed
    // boundary can outlive the response. The suspended instance then fires
    // the run's timers on its next invocation as spurious timeouts.
    waitUntil(run.then(ignoreSettlement, ignoreSettlement));
    return run;
  };

const ignoreSettlement = () => undefined;

/**
 * Runs a Workspace Effect like `runWorkspaceEffect`, but answers every
 * failure with `orElse`: typed failures, defects, and a runner that rejects
 * before entering the Effect, such as when the shared observability runtime
 * cannot be built. A fallback inside the Effect cannot see that last case.
 * Interruption, including an aborted `signal`, and Next.js control flow
 * (redirects, `notFound`, prerender bailouts) propagate as they do from
 * `runWorkspaceEffect`, without `orElse`. `orElse` runs at most once per
 * call. When it serves a fallback, the failure is logged once with
 * `failureCode`; when it throws, the call rejects with that error unlogged,
 * handing the failure to the caller as `runWorkspaceEffect` does.
 */
export const runWorkspaceEffectOrElse =
  <B>(
    operation: string,
    { failureCode, orElse, ...options }: RunWorkspaceEffectOrElseOptions<B>
  ) =>
  async <A, E>(effect: Effect.Effect<A, E, never>): Promise<A | B> => {
    let answer: Result.Result<B, WorkspaceFallbackRejection> | undefined;
    const answerOnce = (cause: unknown) => {
      answer ??= Result.try({
        try: () => orElse(cause),
        catch: (thrown) => new WorkspaceFallbackRejection({ cause: thrown }),
      });
      return answer;
    };
    const answerFailure = <A, E>(
      program: Effect.Effect<A, E, never>
    ): Effect.Effect<Exit.Exit<A | B, E | WorkspaceFallbackRejection>> =>
      program.pipe(
        Effect.catchCause(
          (cause): Effect.Effect<B, E | WorkspaceFallbackRejection> =>
            Cause.hasInterruptsOnly(cause) ||
            causeFailures(cause).some(isNextControlFlow)
              ? Effect.failCause(cause)
              : Effect.fromResult(answerOnce(Cause.squash(cause))).pipe(
                  Effect.tap(() =>
                    Effect.logWarning(
                      "Workspace Effect failed; serving its fallback",
                      { failureCode, cause }
                    ).pipe(
                      // A failing logger must not discard the fallback.
                      Effect.ignoreCause
                    )
                  )
                )
        ),
        Effect.exit
      );

    // A rejection after the shared runtime entered the program can only be
    // an interruption: the program itself settles every failure as an Exit.
    let entered = false;
    const exit = await Effect.sync(() => {
      entered = true;
    })
      .pipe(
        Effect.andThen(answerFailure(effect)),
        runWorkspaceEffect(operation, options)
      )
      .then(
        (exit) => exit,
        (cause: unknown) => {
          if (entered || options.signal?.aborted) throw cause;
          // The shared runtime could not be built: answer through the
          // standalone logger, or unlogged if that logger fails too.
          return answerFailure(Effect.die(cause))
            .pipe(runStandaloneWorkspaceEffect(operation))
            .then(
              (exit) => exit,
              () =>
                Result.match(answerOnce(cause), {
                  onSuccess: Exit.succeed,
                  onFailure: Exit.fail,
                })
            );
        }
      );
    if (Exit.isSuccess(exit)) return exit.value;

    for (const failure of causeFailures(exit.cause)) {
      unstable_rethrow(failure);
    }
    const failure = Cause.squash(exit.cause);
    throw failure instanceof WorkspaceFallbackRejection
      ? failure.cause
      : failure;
  };

const causeFailures = (cause: Cause.Cause<unknown>) =>
  cause.reasons.flatMap((reason) => {
    if (Cause.isFailReason(reason)) return [reason.error];
    if (Cause.isDieReason(reason)) return [reason.defect];
    return [];
  });

const isNextControlFlow = (cause: unknown) =>
  Result.isFailure(Result.try(() => unstable_rethrow(cause)));

export const defineWorkspaceTask =
  <Args extends readonly unknown[], A, E>(
    operation: string,
    handler: (...args: Args) => Effect.Effect<A, E, never>
  ) =>
  (...args: Args): Promise<A> =>
    Effect.suspend(() => handler(...args)).pipe(
      Effect.ensuring(flushTelemetry),
      runWorkspaceEffect(operation, { boundary: "task" })
    );

export const defineWorkspacePage = <Props, A, E>(
  operation: string,
  component: (props: Props) => Effect.Effect<A, E, never>
) =>
  workspaceRuntime.page((props: Props) =>
    component(props).pipe(
      Effect.annotateLogs({
        boundary: "page",
        operation,
      })
    )
  );

/**
 * Schedules `effect` to run with `runWorkspaceEffect` after the current
 * response is sent, so the request never waits for it. A failure to schedule
 * is logged, never raised.
 */
export const runWorkspaceEffectAfterResponse = <A, E>(
  operation: string,
  effect: Effect.Effect<A, E, never>
) =>
  Effect.try({
    try: () => after(() => effect.pipe(runWorkspaceEffect(operation))),
    catch: (cause) =>
      new WorkspaceTelemetryError({
        cause,
        message: `${operation} could not be scheduled`,
      }),
  }).pipe(
    Effect.tapError((error) =>
      Effect.logWarning("Workspace work after the response not scheduled", {
        operation,
        cause: error.cause,
      })
    ),
    Effect.ignore
  );

export const scheduleWorkspaceTelemetryFlush = () =>
  postHogLoggerProvider
    ? runWorkspaceEffectAfterResponse("telemetry.flush", flushTelemetry)
    : Effect.void;

export const WorkspaceObservabilityLive = Layer.merge(
  postHogLoggerProvider
    ? createWorkspaceOtelLoggerLive(postHogLoggerProvider)
    : WorkspaceLoggerLive,
  WorkspaceTracingLive
);

/**
 * Process-wide memo map for Workspace runtimes. Runtimes that build their
 * layers with it reuse layers another runtime has already built, such as
 * `WorkspaceObservabilityLive`.
 */
export const workspaceMemoMap = Layer.makeMemoMapUnsafe();

// Built on first run and kept for the life of the process. It is never
// disposed: telemetry is flushed per request through `after()` and per task
// through `Effect.ensuring`, not by closing a layer scope.
const workspaceRuntime = NextEffect.make({
  layer: WorkspaceObservabilityLive,
  memoMap: workspaceMemoMap,
});

// Telemetry is best effort: an unexpected flush defect must not fail the
// request or task it follows.
const flushTelemetry = flushPostHogLogs({
  provider: postHogLoggerProvider,
}).pipe(
  Effect.ignoreCause({ log: "Warn", message: "PostHog log flush failed" })
);
