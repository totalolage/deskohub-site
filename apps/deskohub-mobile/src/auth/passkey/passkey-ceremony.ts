import { Context, Effect, Layer } from "effect";
import { nativePasskeyCeremonies } from "./native-passkey-ceremonies";
import type { PasskeyFailure } from "./passkey-failure";
import { webPasskeyCeremonies } from "./web-passkey-ceremonies";

/** The passkey a registration ceremony saved to the account. */
export type AddedPasskey = {
  readonly id: string;
  readonly name: string | undefined;
};

export interface PasskeyCeremonyApi {
  /** Whether this device or browser can run a passkey ceremony at all. */
  readonly isSupported: Effect.Effect<boolean>;
  /**
   * Signs in with a passkey saved for the app's sign-in. On success the
   * session exists and the auth client has started refreshing it.
   */
  readonly signIn: Effect.Effect<void, PasskeyFailure>;
  /**
   * Saves a new passkey to the signed-in account. Needs a recent sign-in:
   * a stale one fails as `PasskeyRejected` with `needsReauthentication`.
   */
  readonly addPasskey: (input?: {
    readonly name?: string;
  }) => Effect.Effect<AddedPasskey, PasskeyFailure>;
}

/**
 * The passkey ceremonies of one platform: `Native` runs them through the
 * native passkey module and the Expo auth client, `Web` through Better
 * Auth's browser passkey client. Each runs one ceremony at a time; `Live`
 * picks the running platform's.
 */
export class PasskeyCeremonies extends Context.Service<
  PasskeyCeremonies,
  PasskeyCeremonyApi
>()("deskohub-mobile/PasskeyCeremonies") {
  static Native = Layer.effect(this, nativePasskeyCeremonies);
  static Web = Layer.effect(this, webPasskeyCeremonies);
  /**
   * This platform's ceremonies on its live clients. Metro resolves the
   * platform's layer module; it loads lazily because it imports the native
   * module and the auth clients, which the tests' runtime can't load.
   */
  static Live: Layer.Layer<PasskeyCeremonies> = Layer.unwrap(
    Effect.promise(async () => {
      const { makePasskeyCeremoniesLayer } = await import(
        "./passkey-ceremonies-layer"
      );
      return makePasskeyCeremoniesLayer();
    })
  );
}
