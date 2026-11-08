import { Context, Deferred, Effect, type Exit, Layer } from "effect";
import type { AuthUser } from "./native-auth.service";
import type { NativeSignInFailure } from "./native-sign-in-errors";

type Outcome = Exit.Exit<AuthUser, NativeSignInFailure>;

interface Completion {
  /** Resolves as soon as a callback starts finishing this key. */
  readonly claimed: Deferred.Deferred<void>;
  readonly outcome: Deferred.Deferred<AuthUser, NativeSignInFailure>;
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
  /** Marks `key` as being finished by a completion running under another key. */
  readonly claim: (key: string) => Effect.Effect<void>;
  /** Waits until a callback starts finishing `key`. */
  readonly claimed: (key: string) => Effect.Effect<void>;
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
        claimed: Deferred.makeUnsafe<void>(),
        outcome: Deferred.makeUnsafe<AuthUser, NativeSignInFailure>(),
        started: false,
      };
      completions.set(key, created);
      return created;
    };
    const markClaimed = (completion: Completion) =>
      Deferred.succeed(completion.claimed, undefined);
    return {
      once: <R>(
        key: string,
        complete: Effect.Effect<AuthUser, NativeSignInFailure, R>
      ): Effect.Effect<AuthUser, NativeSignInFailure, R> =>
        Effect.suspend(() => {
          const completion = completionFor(key);
          if (completion.started) return Deferred.await(completion.outcome);
          completion.started = true;
          return markClaimed(completion).pipe(
            Effect.andThen(complete),
            Effect.onExit((exit) => Deferred.done(completion.outcome, exit))
          );
        }),
      claim: (key) =>
        Effect.suspend(() => markClaimed(completionFor(key))).pipe(
          Effect.asVoid
        ),
      claimed: (key) =>
        Effect.suspend(() => Deferred.await(completionFor(key).claimed)),
      outcome: (key) =>
        Effect.suspend(() => Deferred.await(completionFor(key).outcome)),
      settle: (key, outcome) =>
        Effect.suspend(() => {
          const completion = completionFor(key);
          completion.started = true;
          return markClaimed(completion).pipe(
            Effect.andThen(Deferred.done(completion.outcome, outcome))
          );
        }).pipe(Effect.asVoid),
    };
  });
}
