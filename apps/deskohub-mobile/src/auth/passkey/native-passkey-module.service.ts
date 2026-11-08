import { Context, Effect, Layer } from "effect";
import { fromNativePasskeyError } from "./native-passkey-error";
import type {
  NativeAuthenticationRequest,
  NativeCreationRequest,
} from "./passkey-credential";
import type { PasskeyFailure } from "./passkey-failure";

/** The parts of `react-native-passkeys` the ceremonies use. */
export type NativePasskeyModuleSource = {
  readonly isSupported: () => boolean;
  readonly create: (request: NativeCreationRequest) => Promise<unknown>;
  readonly get: (request: NativeAuthenticationRequest) => Promise<unknown>;
};

interface INativePasskeyModule {
  /** Whether the OS can run a passkey ceremony (Android 9+, iOS 15+). */
  readonly isSupported: Effect.Effect<boolean>;
  /**
   * Shows the platform's passkey prompt and resolves the credential JSON it
   * returned, unread. The prompt can't be cancelled, so an interruption
   * waits for the customer to finish with it.
   */
  readonly create: (
    request: NativeCreationRequest
  ) => Effect.Effect<unknown, PasskeyFailure>;
  readonly get: (
    request: NativeAuthenticationRequest
  ) => Effect.Effect<unknown, PasskeyFailure>;
}

/** The native passkey module, Credential Manager on Android. */
export class NativePasskeyModule extends Context.Service<
  NativePasskeyModule,
  INativePasskeyModule
>()("deskohub-mobile/NativePasskeyModule") {
  static fromModule = (passkeys: NativePasskeyModuleSource) =>
    Layer.succeed(this, {
      isSupported: Effect.sync(passkeys.isSupported),
      create: (request) => prompt(() => passkeys.create(request)),
      get: (request) => prompt(() => passkeys.get(request)),
    });
}

const prompt = (show: () => Promise<unknown>) =>
  Effect.tryPromise({ try: show, catch: fromNativePasskeyError }).pipe(
    Effect.uninterruptible
  );
