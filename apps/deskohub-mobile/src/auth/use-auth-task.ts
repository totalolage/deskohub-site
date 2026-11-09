import {
  Cause,
  type Effect,
  Exit,
  Layer,
  ManagedRuntime,
  Option,
} from "effect";
import { useCallback, useEffect, useRef, useState } from "react";

export type AuthTaskState<A, E> =
  | { readonly status: "idle" }
  | { readonly status: "running" }
  | { readonly status: "succeeded"; readonly value: A }
  | { readonly status: "failed"; readonly failure: E };

/** What runs a task's Effect: the native auth runtime, or a plain one. */
export interface AuthTaskRuntime<R> {
  readonly runPromiseExit: <A, E>(
    effect: Effect.Effect<A, E, R>
  ) => Promise<Exit.Exit<A, E>>;
}

/** Runs tasks that need no services, such as the web sign-in steps. */
export const standaloneTaskRuntime = ManagedRuntime.make(Layer.empty);

/**
 * The run edge for one auth flow on a screen. `start` runs the task unless it
 * is already running and resolves with its exit; the state follows it. A
 * defect reads as `unexpected()`, so screens handle one typed failure union.
 */
export const useAuthTask = <Args extends ReadonlyArray<unknown>, A, E, R>(
  runtime: AuthTaskRuntime<R>,
  task: (...args: Args) => Effect.Effect<A, E, R>,
  unexpected: () => E
) => {
  const [state, setState] = useState<AuthTaskState<A, E>>({ status: "idle" });
  const mounted = useRef(true);
  const running = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const start = useCallback(
    async (...args: Args): Promise<Option.Option<Exit.Exit<A, E>>> => {
      if (running.current) return Option.none();
      running.current = true;
      setState({ status: "running" });
      const exit = await runtime.runPromiseExit(task(...args));
      running.current = false;
      if (mounted.current) {
        setState(
          Exit.match(exit, {
            onSuccess: (value) => ({ status: "succeeded", value }),
            onFailure: (cause) => ({
              status: "failed",
              failure: Option.getOrElse(
                Cause.findErrorOption(cause),
                unexpected
              ),
            }),
          })
        );
      }
      return Option.some(exit);
    },
    [runtime, task, unexpected]
  );

  const reset = useCallback(() => {
    if (!running.current) setState({ status: "idle" });
  }, []);

  return { state, start, reset } as const;
};

/** The failure of the first failed task, for one alert over several. */
export const firstFailure = <E>(
  ...states: ReadonlyArray<AuthTaskState<unknown, E>>
): E | undefined => {
  for (const state of states) {
    if (state.status === "failed") return state.failure;
  }
  return undefined;
};

/** The value of the first task that succeeded. */
export const firstSuccess = <A>(
  ...states: ReadonlyArray<AuthTaskState<A, unknown>>
): A | undefined => {
  for (const state of states) {
    if (state.status === "succeeded") return state.value;
  }
  return undefined;
};
