import { Context, Data, Effect, Layer, Option } from "effect";
import type { NativeAuthClient } from "./native-auth-client";

/** The signed-in customer as the app needs it. */
export interface AuthUser {
  readonly id: string;
  readonly email: string;
}

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

interface INativeAuth {
  /** The Workspace origin the client talks to. */
  readonly origin: string;
  /** Claims a magic-link token; the session cookie lands in storage. */
  readonly verifyMagicLink: (
    token: string
  ) => Effect.Effect<void, NativeAuthFailure>;
  /** Redeems a handoff code for a new app session. */
  readonly exchangeHandoff: (
    exchange: HandoffExchange
  ) => Effect.Effect<void, NativeAuthFailure>;
  readonly currentUser: Effect.Effect<
    Option.Option<AuthUser>,
    NativeAuthFailure
  >;
  /** Ends the session on the server and clears the stored cookie. */
  readonly signOut: Effect.Effect<void, NativeAuthFailure>;
}

/**
 * The native Better Auth calls the sign-in flows make. Requests carry the
 * stored session cookie; the Expo plugin stores any new one and signals the
 * `useSession` store.
 */
export class NativeAuth extends Context.Service<NativeAuth, INativeAuth>()(
  "deskohub-mobile/NativeAuth"
) {
  static fromClient(origin: string, client: NativeAuthClient) {
    return Layer.succeed(this, makeNativeAuth(origin, client));
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

const makeNativeAuth = (
  origin: string,
  client: NativeAuthClient
): INativeAuth => ({
  origin,
  verifyMagicLink: (token) =>
    call("verify-magic-link", (signal) =>
      client.magicLink.verify({ query: { token }, fetchOptions: { signal } })
    ).pipe(Effect.asVoid),
  exchangeHandoff: ({ code, codeVerifier, returnUri }) =>
    call("exchange-handoff", (signal) =>
      client.$fetch("/native-handoff/exchange", {
        method: "POST",
        body: { code, code_verifier: codeVerifier, return_uri: returnUri },
        signal,
      })
    ).pipe(Effect.asVoid),
  currentUser: call("get-session", (signal) =>
    client.getSession({ fetchOptions: { signal } })
  ).pipe(
    Effect.map((data) =>
      Option.fromNullishOr(data?.user).pipe(
        Option.map(({ id, email }): AuthUser => ({ id, email }))
      )
    )
  ),
  signOut: call("sign-out", (signal) =>
    client.signOut({ fetchOptions: { signal } })
  ).pipe(Effect.asVoid),
});
