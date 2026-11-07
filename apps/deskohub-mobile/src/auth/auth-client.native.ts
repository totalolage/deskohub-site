import * as SecureStore from "expo-secure-store";
import { resolveApiOrigin } from "./api-origin";
import {
  createNativeAuthClient,
  type NativeAuthClientOptions,
} from "./native-auth-client";

export const apiOrigin = resolveApiOrigin(
  process.env.EXPO_PUBLIC_API_ORIGIN,
  undefined
);

/** What the app's client is built from; sign-ins build their own from it. */
export const authClientOptions: NativeAuthClientOptions = {
  origin: apiOrigin,
  storage: SecureStore,
};

/**
 * The native Better Auth client. The Expo plugin keeps the session cookie in
 * SecureStore, sends it on every request with the `expo-origin` header the
 * server trusts, and restores the session on the next launch. Email sign-in
 * starts on the web bundle (BotID), so the native client only verifies tokens,
 * exchanges handoff codes, runs the passkey ceremonies, reads the session and
 * signs out.
 */
export const authClient = createNativeAuthClient(authClientOptions);
