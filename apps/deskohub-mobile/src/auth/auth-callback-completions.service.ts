import { Context, Deferred, Effect, type Exit, Layer } from "effect";
import type { AuthUser } from "./native-auth.service";
import type { NativeSignInFailure } from "./native-sign-in-errors";

type Outcome = Exit.Exit<AuthUser, NativeSignInFailure>;

interface Completion {
  readonly deferred: Deferred.Deferred<AuthUser, NativeSignInFailure>;
  started: boolean;
}

interface IAuthCallbackCompletions {
  /**
   * Runs `complete` for `key` once per app process; later callers with the
   * same key wait for the first run's outcome instead of redeeming the same
   * single-use token or code again.
   */
  readonly once: <R>(
    key: string,
    complete: Effect.Effect<AuthUser, NativeSignInFailure, R>
  ) => Effect.Effect<AuthUser, NativeSignInFailure, R>;
  /** Waits for the outcome of `key`, however it gets completed. */
  readonly outcome: (
    key: string
  ) => Effect.Effect<AuthUser, NativeSignInFailure>;
  /** Records an outcome for `key` that another completion produced. */
  readonly settle: (key: string, outcome: Outcome) => Effect.Effect<void>;
}

/**
 * Where the auth session's own return and the callback route meet. On
 * Android both see the same `deskohub://auth/callback` URL, in either order,
 * and a cold start sees only the route. Keying each completion by its sign-in
 * attempt lets whichever runs first finish it and the other read the result.
 */
export class AuthCallbackCompletions extends Context.Service<
  AuthCallbackCompletions,
  IAuthCallbackCompletions
>()("deskohub-mobile/AuthCallbackCompletions") {
  static Default = Layer.sync(this, (): IAuthCallbackCompletions => {
    const completions = new Map<string, Completion>();
    const completionFor = (key: string): Completion => {
      const existing = completions.get(key);
      if (existing !== undefined) return existing;
      const created: Completion = {
        deferred: Deferred.makeUnsafe<AuthUser, NativeSignInFailure>(),
        started: false,
      };
      completions.set(key, created);
      return created;
    };
    return {
      once: <R>(
        key: string,
        complete: Effect.Effect<AuthUser, NativeSignInFailure, R>
      ): Effect.Effect<AuthUser, NativeSignInFailure, R> =>
        Effect.suspend(() => {
          const completion = completionFor(key);
          if (completion.started) return Deferred.await(completion.deferred);
          completion.started = true;
          return complete.pipe(
            Effect.onExit((exit) => Deferred.done(completion.deferred, exit))
          );
        }),
      outcome: (key) =>
        Effect.suspend(() => Deferred.await(completionFor(key).deferred)),
      settle: (key, outcome) =>
        Effect.suspend(() => {
          const completion = completionFor(key);
          completion.started = true;
          return Deferred.done(completion.deferred, outcome);
        }).pipe(Effect.asVoid),
    };
  });
}
