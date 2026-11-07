import { Context, Effect, Layer } from "effect";
import { PasskeyCeremonyFailed } from "./passkey-failure";

/** A passkey plugin call's `{ data, error }` result. */
export type PasskeyPluginResult =
  | { readonly data: unknown; readonly error: null }
  | {
      readonly data: unknown;
      readonly error: { readonly code?: string; readonly status?: number };
    };

/** The parts of the web Better Auth client the passkey ceremonies use. */
export type PasskeyPluginClientSource = {
  readonly signIn: { readonly passkey: () => Promise<PasskeyPluginResult> };
  readonly passkey: {
    readonly addPasskey: (input: {
      readonly name?: string;
    }) => Promise<PasskeyPluginResult>;
  };
};

interface IPasskeyPluginClient {
  /** Whether the browser offers WebAuthn at all. */
  readonly isSupported: Effect.Effect<boolean>;
  /**
   * `authClient.signIn.passkey()`. The plugin call can't be cancelled, so an
   * interruption waits for it to settle.
   */
  readonly signIn: Effect.Effect<PasskeyPluginResult, PasskeyCeremonyFailed>;
  /** `authClient.passkey.addPasskey()`, uncancellable the same way. */
  readonly addPasskey: (input: {
    readonly name?: string;
  }) => Effect.Effect<PasskeyPluginResult, PasskeyCeremonyFailed>;
}

/** Better Auth's browser passkey client. */
export class PasskeyPluginClient extends Context.Service<
  PasskeyPluginClient,
  IPasskeyPluginClient
>()("deskohub-mobile/PasskeyPluginClient") {
  static fromClient = (
    client: PasskeyPluginClientSource,
    browserSupportsPasskeys = () =>
      typeof globalThis.PublicKeyCredential === "function"
  ) =>
    Layer.succeed(this, {
      isSupported: Effect.sync(browserSupportsPasskeys),
      signIn: pluginCall(() => client.signIn.passkey()),
      addPasskey: (input) => pluginCall(() => client.passkey.addPasskey(input)),
    });
}

const pluginCall = (call: () => Promise<PasskeyPluginResult>) =>
  Effect.tryPromise({
    try: call,
    catch: (cause) => new PasskeyCeremonyFailed({ step: "request", cause }),
  }).pipe(Effect.uninterruptible);
