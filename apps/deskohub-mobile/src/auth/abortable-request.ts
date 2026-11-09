import { Effect } from "effect";

/**
 * Sends a request that an interruption aborts and then waits out. Better
 * Auth's client runs its response hooks before its promise settles, and the
 * Expo plugin's hooks write the response's cookies and session to
 * SecureStore. An abort can't stop a write already under way, so the
 * request ends only once that write is done and nothing lands after it.
 */
export const abortableRequest = <A, E>(
  send: (signal: AbortSignal) => Promise<A>,
  onFailure: (cause: unknown) => E
): Effect.Effect<A, E> =>
  Effect.suspend(() => {
    const controller = new AbortController();
    let response: Promise<A> | undefined;
    return Effect.tryPromise({
      try: () => {
        response = send(controller.signal);
        return response;
      },
      catch: onFailure,
    }).pipe(
      Effect.onInterrupt(() =>
        Effect.promise(async () => {
          controller.abort();
          await response?.then(
            () => undefined,
            () => undefined
          );
        })
      )
    );
  });
