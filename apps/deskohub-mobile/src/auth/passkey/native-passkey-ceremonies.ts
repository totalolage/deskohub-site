import { Effect, Result, Schema } from "effect";
import { NativePasskeyModule } from "./native-passkey-module.service";
import { oneCeremonyAtATime } from "./one-ceremony-at-a-time";
import {
  type AuthFetchResult,
  PasskeyAuthClient,
} from "./passkey-auth-client.service";
import type { AddedPasskey, PasskeyCeremonyApi } from "./passkey-ceremony";
import {
  NativeAuthentication,
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
 * Every request goes through the Expo auth client, so the challenge cookie
 * from the options response returns with the verification and the session
 * cookie the verification sets lands in SecureStore.
 */

const VerifiedPasskey = Schema.Struct({
  id: Schema.String,
  name: Schema.optional(Schema.NullOr(Schema.String)),
});

export const nativePasskeyCeremonies = Effect.Do.pipe(
  Effect.bind("auth", () => Effect.service(PasskeyAuthClient)),
  Effect.bind("passkeys", () => Effect.service(NativePasskeyModule)),
  Effect.map(({ auth, passkeys }): PasskeyCeremonyApi => {
    const supported = passkeys.isSupported.pipe(
      Effect.filterOrFail(
        (isSupported) => isSupported,
        () => new PasskeyNotSupported()
      )
    );

    /** One request; a refusal carries the Better Auth code. */
    const send = <A>({
      path,
      method,
      body,
      schema,
    }: {
      readonly path: string;
      readonly method: "GET" | "POST";
      readonly body?: unknown;
      readonly schema: Schema.Decoder<A>;
    }) =>
      auth.request(path, { method, body }).pipe(
        Effect.flatMap(accepted),
        Effect.flatMap((data) => decode(schema, data, "response"))
      );

    const signIn = Effect.Do.pipe(
      Effect.tap(() => supported),
      Effect.bind("options", () =>
        send({
          path: "/passkey/generate-authenticate-options",
          method: "GET",
          schema: PasskeyRequestOptions,
        })
      ),
      Effect.bind("assertion", ({ options }) =>
        passkeys
          .get(toNativeAuthenticationRequest(options))
          .pipe(
            Effect.flatMap((result) =>
              decode(NativeAuthentication, result, "authenticator")
            )
          )
      ),
      Effect.tap(({ assertion }) =>
        send({
          path: "/passkey/verify-authentication",
          method: "POST",
          body: { response: toAuthenticationResponseJSON(assertion) },
          schema: Schema.Unknown,
        })
      ),
      Effect.tap(() => auth.refreshSession),
      Effect.asVoid
    );

    const addPasskey = ({ name }: { readonly name?: string } = {}) =>
      Effect.Do.pipe(
        Effect.tap(() => supported),
        Effect.bind("options", () =>
          send({
            path: "/passkey/generate-register-options",
            method: "GET",
            schema: PasskeyCreationOptions,
          })
        ),
        Effect.bind("registration", ({ options }) =>
          passkeys
            .create(toNativeCreationRequest(options))
            .pipe(
              Effect.flatMap((result) =>
                decode(NativeRegistration, result, "authenticator")
              )
            )
        ),
        Effect.bind("passkey", ({ registration }) =>
          send({
            path: "/passkey/verify-registration",
            method: "POST",
            body: { name, response: toRegistrationResponseJSON(registration) },
            schema: VerifiedPasskey,
          })
        ),
        Effect.map(
          ({ passkey }): AddedPasskey => ({
            id: passkey.id,
            name: passkey.name ?? undefined,
          })
        )
      );

    return oneCeremonyAtATime({
      isSupported: passkeys.isSupported,
      signIn,
      addPasskey,
    });
  })
);

/** The response's data, or the server's refusal with its Better Auth code. */
const accepted = ({ data, error }: AuthFetchResult) =>
  Effect.fromResult(
    error === null
      ? Result.succeed(data)
      : Result.fail(
          new PasskeyRejected({ status: error.status, code: error.code })
        )
  );

/** Reads a value the server or the module sent; another shape fails `step`. */
const decode = <A>(
  schema: Schema.Decoder<A>,
  value: unknown,
  step: PasskeyCeremonyFailed["step"]
) =>
  Schema.decodeUnknownEffect(schema)(value).pipe(
    Effect.mapError((cause) => new PasskeyCeremonyFailed({ step, cause }))
  );
