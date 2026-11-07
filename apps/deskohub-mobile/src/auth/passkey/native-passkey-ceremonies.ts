import { Effect, Schema } from "effect";
import { fromNativePasskeyError } from "./native-passkey-error";
import {
  type AddedPasskey,
  oneCeremonyAtATime,
  type PasskeyCeremonies,
} from "./passkey-ceremony";
import {
  NativeAuthentication,
  type NativeAuthenticationRequest,
  type NativeCreationRequest,
  NativeRegistration,
  PasskeyCreationOptions,
  PasskeyRequestOptions,
  toAuthenticationResponseJSON,
  toNativeAuthenticationRequest,
  toNativeCreationRequest,
  toRegistrationResponseJSON,
} from "./passkey-credential";
import {
  PasskeyCeremonyFailed,
  PasskeyNotSupported,
  PasskeyRejected,
} from "./passkey-failure";

/*
 * The passkey ceremonies of the native app, against Better Auth's passkey
 * endpoints:
 *
 * - sign-in: GET /passkey/generate-authenticate-options, the module's `get`,
 *   POST /passkey/verify-authentication `{ response }`;
 * - registration: GET /passkey/generate-register-options, the module's
 *   `create`, POST /passkey/verify-registration `{ name?, response }`.
 *
 * Every request goes through the Expo auth client's `$fetch`, so the
 * challenge cookie from the options response returns with the verification
 * and the session cookie the verification sets lands in SecureStore.
 */

export type AuthFetchOptions = {
  readonly method: "GET" | "POST";
  readonly body?: unknown;
  readonly signal: AbortSignal;
};

/** Better Auth's `{ data, error }` result of a `$fetch` with `throw: false`. */
export type AuthFetchResult = {
  readonly data: unknown;
  readonly error: {
    readonly status: number;
    readonly code?: string;
  } | null;
};

/** The auth client's `$fetch`, relative to its `/api/auth` base URL. */
export type AuthFetch = (
  path: string,
  options: AuthFetchOptions
) => Promise<AuthFetchResult>;

/**
 * The native passkey module. `create` and `get` take the server's options
 * JSON and resolve the credential JSON the platform returned, which the
 * ceremony reads as untrusted.
 */
export type NativePasskeyAuthenticator = {
  readonly isSupported: () => boolean;
  readonly create: (request: NativeCreationRequest) => Promise<unknown>;
  readonly get: (request: NativeAuthenticationRequest) => Promise<unknown>;
};

const VerifiedPasskey = Schema.Struct({
  id: Schema.String,
  name: Schema.optional(Schema.NullOr(Schema.String)),
});

/** Reads a value the server or the module sent; another shape fails `step`. */
const decode = <A>(
  schema: Schema.Decoder<A>,
  value: unknown,
  step: PasskeyCeremonyFailed["step"]
) =>
  Schema.decodeUnknownEffect(schema)(value).pipe(
    Effect.mapError((cause) => new PasskeyCeremonyFailed({ step, cause }))
  );

/**
 * One request. A refusal carries the Better Auth code; interrupting the
 * ceremony aborts the request, so a stale options response can't replace
 * the challenge cookie of the ceremony after it.
 */
const request =
  (fetch: AuthFetch) =>
  <A>(
    path: string,
    method: AuthFetchOptions["method"],
    schema: Schema.Decoder<A>,
    body?: unknown
  ): Effect.Effect<A, PasskeyRejected | PasskeyCeremonyFailed> =>
    Effect.gen(function* () {
      const { data, error } = yield* Effect.tryPromise({
        try: (signal) => fetch(path, { method, body, signal }),
        catch: (cause) => new PasskeyCeremonyFailed({ step: "request", cause }),
      });
      if (error !== null) {
        return yield* new PasskeyRejected({
          status: error.status,
          code: error.code,
        });
      }
      return yield* decode(schema, data, "response");
    });

/**
 * The native prompt. It can't be cancelled, so an interruption waits for
 * the customer to finish with it and then sends nothing further.
 */
const ceremony = <A>(
  prompt: () => Promise<unknown>,
  schema: Schema.Decoder<A>
) =>
  Effect.tryPromise({ try: prompt, catch: fromNativePasskeyError }).pipe(
    Effect.uninterruptible,
    Effect.flatMap((result) => decode(schema, result, "authenticator"))
  );

export const makeNativePasskeyCeremonies = ({
  fetch,
  authenticator,
  refreshSession,
}: {
  readonly fetch: AuthFetch;
  readonly authenticator: NativePasskeyAuthenticator;
  /** Tells the auth client the session changed. */
  readonly refreshSession: () => void;
}): PasskeyCeremonies => {
  const send = request(fetch);
  const supported = Effect.suspend(() =>
    authenticator.isSupported()
      ? Effect.void
      : Effect.fail(new PasskeyNotSupported())
  );

  const signIn = Effect.gen(function* () {
    yield* supported;
    const options = yield* send(
      "/passkey/generate-authenticate-options",
      "GET",
      PasskeyRequestOptions
    );
    const assertion = yield* ceremony(
      () => authenticator.get(toNativeAuthenticationRequest(options)),
      NativeAuthentication
    );
    yield* send("/passkey/verify-authentication", "POST", Schema.Unknown, {
      response: toAuthenticationResponseJSON(assertion),
    });
    refreshSession();
  });

  const addPasskey = ({ name }: { readonly name?: string } = {}) =>
    Effect.gen(function* () {
      yield* supported;
      const options = yield* send(
        "/passkey/generate-register-options",
        "GET",
        PasskeyCreationOptions
      );
      const registration = yield* ceremony(
        () => authenticator.create(toNativeCreationRequest(options)),
        NativeRegistration
      );
      const passkey = yield* send(
        "/passkey/verify-registration",
        "POST",
        VerifiedPasskey,
        { name, response: toRegistrationResponseJSON(registration) }
      );
      return {
        id: passkey.id,
        name: passkey.name ?? undefined,
      } satisfies AddedPasskey;
    });

  return oneCeremonyAtATime({
    isSupported: authenticator.isSupported,
    signIn,
    addPasskey,
  });
};
