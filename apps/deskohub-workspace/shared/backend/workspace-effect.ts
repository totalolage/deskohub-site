import { NextEffect } from "@deskohub/next-effect";
import { NodeHttpServer } from "@effect/platform-node";
import { waitUntil } from "@vercel/functions";
import { Cause, Data, Effect, Exit, Layer, Result } from "effect";
import { HttpRouter } from "effect/unstable/http";
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

export type WorkspaceEffectBoundary =
  | "action"
  | "page"
  | "route"
  | "run"
  | "task";

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
  <A, E>(effect: Effect.Effect<A, E, never>): Promise<A> =>
    runWorkspaceExit(operation, options, effect).then(NextEffect.settle);

/**
 * The `Exit` of a Workspace run, a runtime that could not be built included.
 * Never rejects.
 */
const runWorkspaceExit = <A, E>(
  operation: string,
  options: RunWorkspaceEffectOptions,
  effect: Effect.Effect<A, E, never>
) => {
  const exit = workspaceRuntime.runExit(
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
  waitUntil(exit.then(ignoreSettlement));
  return exit;
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
            !isRecoverableCause(cause)
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

    // The shared runtime could not be built: answer through the standalone
    // logger, or unlogged if that logger fails too.
    const answerRuntimeBuildFailure = (cause: unknown) =>
      answerFailure(Effect.die(cause))
        .pipe(runStandaloneWorkspaceEffect(operation))
        .then(
          (exit) => exit,
          () =>
            Result.match(answerOnce(cause), {
              onSuccess: Exit.succeed,
              onFailure: Exit.fail,
            })
        );

    const settleAnswer = <A, E>(
      exit: Exit.Exit<A, E | WorkspaceFallbackRejection>
    ) =>
      NextEffect.settle(
        Exit.mapError(exit, (failure) =>
          failure instanceof WorkspaceFallbackRejection
            ? failure.cause
            : failure
        )
      );

    const run = await runWorkspaceExit(
      operation,
      options,
      answerFailure(effect)
    );
    if (Exit.isSuccess(run)) return settleAnswer(run.value);
    // The program settles every failure it may answer as its value, so any
    // other failure of the run is an interruption, Next.js control flow, or a
    // shared runtime that could not be built.
    if (options.signal?.aborted || !isRecoverableCause(run.cause)) {
      return NextEffect.settle(Exit.failCause(run.cause));
    }
    return settleAnswer(
      await answerRuntimeBuildFailure(Cause.squash(run.cause))
    );
  };

const causeFailures = (cause: Cause.Cause<unknown>) =>
  cause.reasons.flatMap((reason) => {
    if (Cause.isFailReason(reason)) return [reason.error];
    if (Cause.isDieReason(reason)) return [reason.defect];
    return [];
  });

const isNextControlFlow = (cause: unknown) =>
  Result.isFailure(Result.try(() => unstable_rethrow(cause)));

/**
 * The Next.js control flow `cause` carries, such as a redirect, `notFound`,
 * or a prerender bailout, which must reach Next.js unchanged. Undefined when
 * the cause holds only real failures and interruptions.
 */
export const findNextControlFlow = (cause: Cause.Cause<unknown>) =>
  causeFailures(cause).find(isNextControlFlow);

/**
 * `cause` with each typed failure as a defect and every other reason, such as
 * interruption or Next.js control flow beside it, kept as it was.
 */
export const failuresAsDefects = <E>(cause: Cause.Cause<E>) =>
  Cause.fromReasons<never>(
    cause.reasons.map((reason) =>
      Cause.isFailReason(reason) ? Cause.makeDieReason(reason.error) : reason
    )
  );

/**
 * Whether a fallback may answer `cause`: it is neither only interruption nor
 * carries Next.js control flow, both of which must propagate unchanged.
 */
export const isRecoverableCause = (cause: Cause.Cause<unknown>) =>
  !Cause.hasInterruptsOnly(cause) && findNextControlFlow(cause) === undefined;

/**
 * Answers every failure a fallback may answer, defects included, with
 * `onFailure`. Interruption and Next.js control flow propagate, with any typed
 * failure beside them as a defect (`failuresAsDefects`), so the result never
 * fails.
 */
export const catchRecoverableCause =
  <B, R2>(
    onFailure: (cause: Cause.Cause<unknown>) => Effect.Effect<B, never, R2>
  ) =>
  <A, E, R>(
    self: Effect.Effect<A, E, R>
  ): Effect.Effect<A | B, never, R | R2> =>
    self.pipe(
      Effect.catchCause((cause) =>
        isRecoverableCause(cause)
          ? onFailure(cause)
          : Effect.failCause(failuresAsDefects(cause))
      )
    );

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

const WorkspaceObservabilityLive = Layer.merge(
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
const workspaceMemoMap = Layer.makeMemoMapUnsafe();

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

/**
 * Serves an Effect HTTP API to web `Request`s with the Workspace's censoring
 * logger and tracer and Node's HTTP services. The API runs outside the
 * Workspace runtime: its layer builds once, on the first request, with the
 * runtime's memo map, so it reuses the observability instance the runtime
 * already built. Like the runtime, it is never disposed. Effect's own request
 * logger is off; log a failure's cause before mapping it to a cause-less
 * public error.
 */
export const toWorkspaceWebHandler = <A, E>(
  api: Layer.Layer<
    A,
    E,
    | HttpRouter.HttpRouter
    | Layer.Success<typeof NodeHttpServer.layerHttpServices>
  >
): ((request: Request) => Promise<Response>) => {
  const { handler } = HttpRouter.toWebHandler(
    Layer.merge(api, WorkspaceObservabilityLive).pipe(
      Layer.provide(NodeHttpServer.layerHttpServices)
    ),
    { disableLogger: true, memoMap: workspaceMemoMap }
  );
  return (request) => handler(request);
};
