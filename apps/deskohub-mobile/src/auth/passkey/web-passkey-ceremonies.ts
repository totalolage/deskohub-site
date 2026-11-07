import { Effect, Schema } from "effect";
import { oneCeremonyAtATime, type PasskeyCeremonies } from "./passkey-ceremony";
import {
  PasskeyAlreadyRegistered,
  PasskeyCancelled,
  PasskeyCeremonyFailed,
  type PasskeyFailure,
  PasskeyNotSupported,
  PasskeyRejected,
} from "./passkey-failure";

/*
 * The web bundle runs the ceremonies through Better Auth's browser passkey
 * client, `authClient.signIn.passkey()` and `authClient.passkey.addPasskey()`.
 * The site wraps sign-in in its own request because its autofill attempt can
 * replace the button's challenge cookie, and the plugin call takes no abort
 * signal to stop it. The app offers no passkey autofill, and
 * `oneCeremonyAtATime` keeps a second ceremony from starting while a plugin
 * call is still running, so the plugin calls serve as they are.
 */

/** A plugin call's `{ data, error }` result. */
export type PasskeyPluginResult = {
  readonly data: unknown;
  readonly error: {
    readonly code?: string;
    readonly status?: number;
  } | null;
};

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

/** Maps a plugin call's error to a ceremony failure. */
export const fromPasskeyPluginError = (
  error: NonNullable<PasskeyPluginResult["error"]>
): PasskeyFailure => {
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

const AddedPasskeyData = Schema.Struct({
  id: Schema.String,
  name: Schema.optional(Schema.NullOr(Schema.String)),
});

export const makeWebPasskeyCeremonies = ({
  isSupported,
  signIn,
  addPasskey,
}: {
  readonly isSupported: () => boolean;
  readonly signIn: () => Promise<PasskeyPluginResult>;
  readonly addPasskey: (input: {
    readonly name?: string;
  }) => Promise<PasskeyPluginResult>;
}): PasskeyCeremonies => {
  /**
   * One plugin call. It can't be cancelled, so an interruption waits for it
   * to settle and keeps the next ceremony from starting before then.
   */
  const call = (run: () => Promise<PasskeyPluginResult>) =>
    Effect.gen(function* () {
      if (!isSupported()) return yield* new PasskeyNotSupported();
      const { data, error } = yield* Effect.tryPromise({
        try: run,
        catch: (cause) => new PasskeyCeremonyFailed({ step: "request", cause }),
      }).pipe(Effect.uninterruptible);
      if (error !== null) return yield* fromPasskeyPluginError(error);
      return data;
    });

  return oneCeremonyAtATime({
    isSupported,
    signIn: Effect.asVoid(call(signIn)),
    addPasskey: (input = {}) =>
      call(() => addPasskey(input)).pipe(
        Effect.flatMap((data) =>
          Schema.decodeUnknownEffect(AddedPasskeyData)(data).pipe(
            Effect.mapError(
              (cause) => new PasskeyCeremonyFailed({ step: "response", cause })
            )
          )
        ),
        Effect.map(({ id, name }) => ({ id, name: name ?? undefined }))
      ),
  });
};
