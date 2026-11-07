import * as SecureStore from "expo-secure-store";
import { resolveApiOrigin } from "./api-origin";
import { createNativeAuthClient } from "./native-auth-client";
import { developmentPreviewAccess } from "./preview-access";

export const apiOrigin = resolveApiOrigin(
  process.env.EXPO_PUBLIC_API_ORIGIN,
  undefined
);

/**
 * A development build pointed at a deployment-protected preview. Set only
 * from a local, uncommitted environment when Metro bundles a development
 * build; `__DEV__` drops it from release bundles.
 */
export const previewAccess = developmentPreviewAccess(
  __DEV__,
  __DEV__ ? process.env.EXPO_PUBLIC_DEV_VERCEL_PROTECTION_BYPASS : undefined
);

/**
 * The native Better Auth client. The Expo plugin keeps the session cookie in
 * SecureStore, sends it on every request with the `expo-origin` header the
 * server trusts, and restores the session on the next launch. Email sign-in
 * starts on the web bundle (BotID), so the native client only verifies tokens,
 * exchanges handoff codes, runs the passkey ceremonies, reads the session and
 * signs out.
 */
export const authClient = createNativeAuthClient({
  origin: apiOrigin,
  storage: SecureStore,
  previewAccess,
});
