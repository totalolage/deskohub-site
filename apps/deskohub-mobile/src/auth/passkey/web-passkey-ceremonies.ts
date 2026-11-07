import { Effect, Result, Schema } from "effect";
import { oneCeremonyAtATime } from "./one-ceremony-at-a-time";
import type { PasskeyCeremonyApi } from "./passkey-ceremony";
import {
  PasskeyAlreadyRegistered,
  PasskeyCancelled,
  PasskeyCeremonyFailed,
  type PasskeyFailure,
  PasskeyNotSupported,
  PasskeyRejected,
} from "./passkey-failure";
import {
  PasskeyPluginClient,
  type PasskeyPluginResult,
} from "./passkey-plugin-client.service";

/*
 * The web bundle runs the ceremonies through Better Auth's browser passkey
 * client, `authClient.signIn.passkey()` and `authClient.passkey.addPasskey()`.
 * The site wraps sign-in in its own request because its autofill attempt can
 * replace the button's challenge cookie, and the plugin call takes no abort
 * signal to stop it. The app offers no passkey autofill, and
 * `oneCeremonyAtATime` keeps a second ceremony from starting while a plugin
 * call is still running, so the plugin calls serve as they are. One cost:
 * the plugin reports a sign-in verification that never reached the server
 * as `AUTH_CANCELLED`, so it settles quietly like a closed prompt.
 */

/**
 * Browser outcomes without a passkey. A dismissed prompt reaches the plugin
 * as `NotAllowedError`, which SimpleWebAuthn passes through; an aborted one
 * as `ERROR_CEREMONY_ABORTED`; any other error of the sign-in ceremony as
 * `AUTH_CANCELLED`. The site's sign-in reads these the same way.
 */
const cancelledCodes = new Set([
  "AUTH_CANCELLED",
  "ERROR_CEREMONY_ABORTED",
  "ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY",
]);

type PluginError = NonNullable<PasskeyPluginResult["error"]>;

/** Maps a plugin call's error to a ceremony failure. */
export const fromPasskeyPluginError = (error: PluginError): PasskeyFailure => {
  const code = error.code ?? "";
  if (cancelledCodes.has(code)) return new PasskeyCancelled();
  if (code === "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED") {
    return new PasskeyAlreadyRegistered();
  }
  // The browser's WebAuthn errors and the plugin's own fallback.
  if (code.startsWith("ERROR_") || code === "UNKNOWN_ERROR") {
    return new PasskeyCeremonyFailed({ step: "authenticator", cause: error });
  }
  return new PasskeyRejected({ status: error.status ?? 0, code: error.code });
};

/** The call's data, or its error as a ceremony failure. */
const accepted = ({ data, error }: PasskeyPluginResult) =>
  Effect.fromResult(
    error === null
      ? Result.succeed(data)
      : Result.fail(fromPasskeyPluginError(error))
  );

const AddedPasskeyData = Schema.Struct({
  id: Schema.String,
  name: Schema.optional(Schema.NullOr(Schema.String)),
});

export const webPasskeyCeremonies = Effect.service(PasskeyPluginClient).pipe(
  Effect.map((plugin): PasskeyCeremonyApi => {
    const supported = plugin.isSupported.pipe(
      Effect.filterOrFail(
        (isSupported) => isSupported,
        () => new PasskeyNotSupported()
      )
    );
    return oneCeremonyAtATime({
      isSupported: plugin.isSupported,
      signIn: supported.pipe(
        Effect.andThen(plugin.signIn),
        Effect.flatMap(accepted),
        Effect.asVoid
      ),
      addPasskey: (input = {}) =>
        supported.pipe(
          Effect.andThen(plugin.addPasskey(input)),
          Effect.flatMap(accepted),
          Effect.flatMap((data) =>
            Schema.decodeUnknownEffect(AddedPasskeyData)(data).pipe(
              Effect.mapError(
                (cause) =>
                  new PasskeyCeremonyFailed({ step: "response", cause })
              )
            )
          ),
          Effect.map(({ id, name }) => ({ id, name: name ?? undefined }))
        ),
    });
  })
);
