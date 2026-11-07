import { Context, Data, Effect, Layer, Option, Semaphore } from "effect";
import type { AuthUser } from "./auth-session-state";
import { makeMemorySecureStore } from "./memory-secure-store";
import {
  createNativeAuthClient,
  moveSession,
  type NativeAuthClient,
  type NativeAuthClientOptions,
} from "./native-auth-client";

export type { AuthUser } from "./auth-session-state";

export type NativeAuthOperation =
  | "verify-magic-link"
  | "exchange-handoff"
  | "get-session"
  | "sign-out";

/** The request didn't reach the server or its answer couldn't be read. */
export class NativeAuthUnavailable extends Data.TaggedError(
  "NativeAuthUnavailable"
)<{
  readonly operation: NativeAuthOperation;
  readonly cause?: unknown;
}> {}

/** The server refused; `code` is its Better Auth error code. */
export class NativeAuthRejected extends Data.TaggedError("NativeAuthRejected")<{
  readonly operation: NativeAuthOperation;
  readonly status?: number;
  readonly code?: string;
}> {}

export type NativeAuthFailure = NativeAuthUnavailable | NativeAuthRejected;

export interface HandoffExchange {
  readonly code: string;
  readonly codeVerifier: string;
  readonly returnUri: string;
}

/**
 * A session a sign-in just opened. It is held apart from the app's own
 * session until the app accepts it, so a session the app refuses never
 * replaces the one it has.
 */
export interface SignInSession {
  /** The account the session belongs to. */
  readonly user: Effect.Effect<Option.Option<AuthUser>, NativeAuthFailure>;
  /** Makes it the app's session and tells `useSession`. */
  readonly accept: Effect.Effect<void>;
  /** Ends it on the server; the app's own session is untouched. */
  readonly revoke: Effect.Effect<void, NativeAuthFailure>;
}

interface INativeAuth {
  /** The Workspace origin the client talks to. */
  readonly origin: string;
  /** Claims a magic-link token for a new session. */
  readonly verifyMagicLink: (
    token: string
  ) => Effect.Effect<SignInSession, NativeAuthFailure>;
  /** Redeems a handoff code for a new app session. */
  readonly exchangeHandoff: (
    exchange: HandoffExchange
  ) => Effect.Effect<SignInSession, NativeAuthFailure>;
  readonly currentUser: Effect.Effect<
    Option.Option<AuthUser>,
    NativeAuthFailure
  >;
  /** Ends the session on the server and clears the stored cookie. */
  readonly signOut: Effect.Effect<void, NativeAuthFailure>;
}

/**
 * The native Better Auth calls the sign-in flows make. Requests carry the
 * stored session cookie. A sign-in runs on a client of its own over memory,
 * so its new session stays out of the app's storage until it is accepted.
 */
export class NativeAuth extends Context.Service<NativeAuth, INativeAuth>()(
  "deskohub-mobile/NativeAuth"
) {
  /** `options` are the ones `client` was built from. */
  static fromClient(
    client: NativeAuthClient,
    options: NativeAuthClientOptions
  ) {
    return Layer.succeed(NativeAuth, makeNativeAuth(client, options));
  }
}

/** The `{ data, error }` result every Better Auth client call resolves to. */
interface ClientResult<A> {
  readonly data: A | null;
  readonly error: {
    readonly status?: number;
    readonly code?: string;
  } | null;
}

const call = <A>(
  operation: NativeAuthOperation,
  request: (signal: AbortSignal) => Promise<ClientResult<A>>
): Effect.Effect<A | null, NativeAuthFailure> =>
  Effect.tryPromise({
    try: request,
    catch: (cause) => new NativeAuthUnavailable({ operation, cause }),
  }).pipe(
    Effect.flatMap(({ data, error }) =>
      error === null
        ? Effect.succeed(data)
        : Effect.fail(
            new NativeAuthRejected({
              operation,
              status: error.status,
              code: error.code,
            })
          )
    )
  );

const userOf = (client: NativeAuthClient) =>
  call("get-session", (signal) =>
    client.getSession({ fetchOptions: { signal } })
  ).pipe(
    Effect.map((data) =>
      Option.fromNullishOr(data?.user).pipe(
        Option.map(({ id, email }): AuthUser => ({ id, email }))
      )
    )
  );

const signOutOf = (client: NativeAuthClient) =>
  call("sign-out", (signal) =>
    client.signOut({ fetchOptions: { signal } })
  ).pipe(Effect.asVoid);

const makeNativeAuth = (
  client: NativeAuthClient,
  options: NativeAuthClientOptions
): INativeAuth => {
  // Two sign-ins accepted at once would interleave their writes.
  const acceptance = Semaphore.makeUnsafe(1);
  const openSession = <A>(
    operation: NativeAuthOperation,
    request: (
      signIn: NativeAuthClient,
      signal: AbortSignal
    ) => Promise<ClientResult<A>>
  ): Effect.Effect<SignInSession, NativeAuthFailure> =>
    Effect.suspend(() => {
      const storage = makeMemorySecureStore();
      const signIn = createNativeAuthClient({ ...options, storage });
      return call(operation, (signal) => request(signIn, signal)).pipe(
        Effect.as({
          user: userOf(signIn),
          // The writes can't be called off once they start, so the move and
          // its signal finish before the permit is released.
          accept: acceptance.withPermits(1)(
            Effect.promise(() => moveSession(storage, options.storage)).pipe(
              Effect.andThen(
                Effect.sync(() => client.$store.notify("$sessionSignal"))
              ),
              Effect.uninterruptible
            )
          ),
          revoke: signOutOf(signIn),
        })
      );
    });
  return {
    origin: options.origin,
    verifyMagicLink: (token) =>
      openSession("verify-magic-link", (signIn, signal) =>
        signIn.magicLink.verify({ query: { token }, fetchOptions: { signal } })
      ),
    exchangeHandoff: ({ code, codeVerifier, returnUri }) =>
      openSession("exchange-handoff", (signIn, signal) =>
        signIn.$fetch("/native-handoff/exchange", {
          method: "POST",
          body: { code, code_verifier: codeVerifier, return_uri: returnUri },
          signal,
        })
      ),
    currentUser: userOf(client),
    signOut: signOutOf(client),
  };
};
