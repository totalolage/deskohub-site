import { Layer, ManagedRuntime } from "effect";
import * as SecureStore from "expo-secure-store";
import { AuthCallbackCompletions } from "./auth-callback-completions.service";
import { authClient, authClientOptions } from "./auth-client.native";
import { AuthCrypto } from "./auth-crypto.service";
import { AuthSessionBrowser } from "./auth-session-browser.service";
import { NativeAuth } from "./native-auth.service";
import { PendingSignIns } from "./pending-sign-in.service";

/**
 * The native app's one auth runtime. Every sign-in screen, the callback route
 * and reauthentication run through it, so they share the completion registry
 * that keeps a callback from being redeemed twice.
 */
export const nativeAuthRuntime = ManagedRuntime.make(
  Layer.mergeAll(
    NativeAuth.fromClient(authClient, authClientOptions),
    PendingSignIns.fromStore(SecureStore),
    AuthSessionBrowser.Live,
    AuthCrypto.Live,
    AuthCallbackCompletions.Default
  )
);
